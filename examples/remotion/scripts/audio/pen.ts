// The pen on paper: a scratch that follows the renderer's own strokes — when
// each starts and ends, how fast the pen moves along it — for any clock that
// maps the video's frames to the text's timeline, so a scrubbed title
// scratches backwards too.
import { computeTimeline, type TegakiBundle, type TegakiGlyphData } from 'tegaki/core';
import { Biquad, type Bus, rng, SR } from './dsp.ts';

export interface PenStroke {
  /** Timeline seconds. */
  start: number;
  dur: number;
  /** Font units. */
  length: number;
}

const strokeLength = (p: TegakiGlyphData['s'][number]['p']) => {
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i]![0]! - p[i - 1]![0]!, p[i]![1]! - p[i - 1]![1]!);
  return Math.max(len, 20);
};

/** The strokes of `text` as the renderer times them (before shaping), and the timeline's length. */
export function strokesOf(text: string, font: TegakiBundle): { strokes: PenStroke[]; length: number } {
  const tl = computeTimeline(text, font);
  const strokes: PenStroke[] = [];
  for (const e of tl.entries) {
    const glyph = (font.glyphData as Record<string, TegakiGlyphData>)[e.char];
    if (!glyph || !e.hasGlyph) continue;
    const scale = e.strokeTimeScale ?? 1;
    glyph.s.forEach((s, si) => {
      const delay = e.strokeDelays?.[si] ?? s.d * scale;
      strokes.push({ start: e.offset + delay, dur: Math.max(0.02, s.a * scale), length: strokeLength(s.p) });
    });
  }
  return { strokes, length: tl.totalDuration };
}

/** A single glyph's strokes, in its own seconds. */
export function glyphStrokes(glyph: TegakiGlyphData): PenStroke[] {
  return glyph.s.map((s) => ({ start: s.d, dur: Math.max(0.02, s.a), length: strokeLength(s.p) }));
}

export interface PenTone {
  /** Band center, Hz: a felt tip is lower, a pencil or chalk higher. */
  f: number;
  q: number;
  /** Clicks of the paper's tooth, 0–1. */
  crackle: number;
}

export const TONES = {
  marker: { f: 2600, q: 0.9, crackle: 0.15 },
  pencil: { f: 4200, q: 1.1, crackle: 0.35 },
  brush: { f: 1300, q: 0.7, crackle: 0.02 },
  chalk: { f: 3400, q: 0.8, crackle: 0.9 },
  nib: { f: 5200, q: 1.4, crackle: 0.25 },
} satisfies Record<string, PenTone>;

export interface PenCue {
  strokes: readonly PenStroke[];
  /** Timeline seconds at a video frame (fractional), or `null` while the text isn't there. */
  clock: (frame: number) => number | null;
  /** Video frames to render between. */
  from: number;
  to: number;
  fps: number;
  gain?: number;
  pan?: number;
  tone?: PenTone;
  seed?: number;
}

/** A clock for a text written over `frames` frames from `from`, as `<Write frames>` paces it. */
export const framesClock = (from: number, frames: number, length: number) => (f: number) =>
  f < from ? null : ((f - from) / frames) * length;
/** A clock for a text written at `speed` times its own pace from `from`. */
export const speedClock = (from: number, speed: number, fps: number) => (f: number) => (f < from ? null : ((f - from) / fps) * speed);

/** Add strokes after the writing: an annotation's mark, `delay` seconds after the text ends, drawn over `dur`. */
export function withMark(pen: { strokes: PenStroke[]; length: number }, delay: number, dur: number, length = 3000) {
  return { strokes: [...pen.strokes, { start: pen.length + delay, dur, length }], length: pen.length + delay + dur };
}

const BLOCK = 48;

/** Render a pen cue into `bus`. */
export function pen(bus: Bus, cue: PenCue) {
  const { strokes, clock, fps, gain = 0.1, pan = 0, tone = TONES.marker, seed = 1 } = cue;
  const r = rng(seed);
  const bp = new Biquad();
  const hp = new Biquad().set('hp', 900, 0.7);
  const body = new Biquad().set('bp', 700, 0.8);
  const start = Math.floor((cue.from / fps) * SR);
  const end = Math.ceil((cue.to / fps) * SR);
  let grain = 0;
  let env0 = 0;
  for (let b = start; b < end; b += BLOCK) {
    const f0 = (b / SR) * fps;
    const f1 = ((b + BLOCK) / SR) * fps;
    const t0 = clock(f0);
    const t1 = clock(f1);
    let env1 = 0;
    let speedN = 0;
    if (t0 !== null && t1 !== null) {
      const vel = (t1 - t0) / (BLOCK / SR); // timeline seconds per second
      const T = (t0 + t1) / 2;
      for (const s of strokes) {
        if (T < s.start || T > s.start + s.dur) continue;
        const u = (T - s.start) / s.dur;
        // The renderer eases each stroke out: the pen starts fast and slows.
        const speed = 2 * (1 - u) * (s.length / s.dur) * Math.abs(vel);
        const n = Math.min(1.6, (speed / 2600) ** 0.6);
        if (n > env1) {
          env1 = n;
          speedN = n;
        }
      }
    }
    bp.set('bp', tone.f * (0.8 + 0.35 * speedN), tone.q);
    for (let i = 0; i < BLOCK; i++) {
      const k = i / BLOCK;
      const env = env0 + (env1 - env0) * k;
      if (env < 1e-4) continue;
      const x = r() * 2 - 1;
      // The paper's tooth: a slow wobble and the odd click.
      grain += (r() - 0.5) * 0.08 - grain * 0.002;
      const tooth = 0.65 + Math.max(-0.4, Math.min(0.6, grain * 3));
      const clickV = r() < tone.crackle * 0.004 * env ? (r() * 2 - 1) * 4 : 0;
      const v = (hp.run(bp.run(x)) * tooth + body.run(x) * 0.25 + clickV * 0.3) * env * gain;
      bus.add(b + i, v, pan);
    }
    env0 = env1;
  }
}
