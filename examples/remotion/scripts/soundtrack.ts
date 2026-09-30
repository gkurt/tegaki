/// <reference types="bun" />
// Scores the launch video: writes public/launch-soundtrack.wav, the music and
// every sound effect, cued from the same timing the scenes use
// (src/launch/timing.ts) and the pen from the renderer's own stroke timings.
//
//   bun scripts/soundtrack.ts
//
// No samples: every sound is synthesized, and seeded, so the file is the
// same each time.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TegakiBundle, TegakiGlyphData } from 'tegaki/core';
import amiri from 'tegaki/fonts/amiri';
import atma from 'tegaki/fonts/atma';
import caveat from 'tegaki/fonts/caveat';
import hersheyScript from 'tegaki/fonts/hershey-script';
import italianno from 'tegaki/fonts/italianno';
import kleeOne from 'tegaki/fonts/klee-one';
import lxgwWenkai from 'tegaki/fonts/lxgw-wenkai';
import nanumPenScript from 'tegaki/fonts/nanum-pen-script';
import parisienne from 'tegaki/fonts/parisienne';
import suezOne from 'tegaki/fonts/suez-one';
import tangerine from 'tegaki/fonts/tangerine';
import tillana from 'tegaki/fonts/tillana';
import {
  BAR,
  BEAT,
  DURATION,
  EVERYWHERE,
  FPS,
  OUTRO,
  PLUGINS,
  playhead,
  SCENE,
  SCRIPTS,
  type SceneId,
  STUDIO,
  TITLE,
  VIDEO,
  WIPES,
} from '../src/launch/timing.ts';
import { Biquad, Bus, pingPong, reverb, SR, sec, wav } from './audio/dsp.ts';
import {
  bass,
  bell,
  blips,
  clap,
  click,
  crackle,
  hat,
  impact,
  key,
  kick,
  neonHum,
  pad,
  pluck,
  riser,
  shaker,
  sparkle,
  tap,
  whoosh,
} from './audio/instruments.ts';
import { framesClock, glyphStrokes, type PenTone, pen, speedClock, strokesOf, TONES, withMark } from './audio/pen.ts';

const LENGTH = sec(DURATION / FPS);
/** Seconds at a frame. */
const s = (frame: number) => frame / FPS;
/** Seconds at a frame of a scene. */
const at = (scene: SceneId, frame: number) => s(SCENE[scene].at + frame);
/** Seconds at a bar and beat of the music. */
const bt = (bar: number, beat = 0) => s(bar * BAR + beat * BEAT);

const music = new Bus(LENGTH); // ducked by the kick
const drums = new Bus(LENGTH);
const echoSend = new Bus(LENGTH);
const sfx = new Bus(LENGTH);
const verbSend = new Bus(LENGTH);
const kicks: number[] = [];

// ---------------------------------------------------------------------------
// Music: D major, 107.46 BPM, a bar to every 67 frames
// ---------------------------------------------------------------------------

const CH = {
  D: { bass: 38, pad: [50, 57, 61, 64, 66] },
  A: { bass: 33, pad: [52, 57, 59, 61, 66] },
  Bm: { bass: 35, pad: [50, 54, 57, 59, 61] },
  G: { bass: 31, pad: [54, 57, 59, 62, 66] },
  Fsm: { bass: 42, pad: [52, 57, 61, 64] },
  Em: { bass: 40, pad: [55, 59, 62, 64, 66] },
  A7: { bass: 33, pad: [55, 57, 62, 64, 67] },
};
const PROGRESSION = [CH.D, CH.D, CH.Bm, CH.G, CH.D, CH.A, CH.Bm, CH.G, CH.G, CH.A, CH.Fsm, CH.Bm, CH.G, CH.A, CH.Em, CH.A7];
// How open the pad's filter is, bar by bar: it brightens toward the drop, dims in the editor, opens for the end.
const BRIGHT = [650, 800, 950, 1100, 1300, 1400, 1500, 1700, 2600, 2700, 2800, 2900, 1500, 1500, 2200, 2600];

PROGRESSION.forEach((c, bar) => {
  pad(music, bt(bar), s(BAR) * 1.02, c.pad, {
    gain: bar < 2 ? 0.035 : 0.042,
    bright: BRIGHT[bar]!,
    attack: bar === 0 ? 2 : 0.25,
    release: 1.2,
  });
});
// The last chord, held to the end.
pad(music, bt(16), s(DURATION - 16 * BAR) - 0.6, [50, 57, 61, 64, 66, 69], { gain: 0.05, bright: 3200, attack: 0.05, release: 1.6 });

// Bells over the title as the name writes, and again at the end.
for (const [bar, beat, m] of [
  [0, 1.5, 78],
  [0, 3, 76],
  [1, 0, 81],
  [1, 1.5, 78],
  [1, 3, 74],
] as const) {
  bell(echoSend, bt(bar, beat), m, { gain: 0.07, decay: 1.4 });
}
for (const [beat, m] of [
  [0, 78],
  [0.75, 81],
  [1.5, 86],
] as const) {
  bell(echoSend, bt(16, beat), m, { gain: 0.08, decay: 2.2 });
}

// Drums and bass by section.
for (let bar = 4; bar < 16; bar++) {
  const c = PROGRESSION[bar]!;
  const drop = bar >= 8 && bar < 12;
  const editor = bar === 12 || bar === 13;
  const build = bar >= 14;
  const studio = bar < 8;
  const kicksAt = studio ? (bar === 7 ? [0] : [0, 2]) : editor ? [0, 2.5] : [0, 1, 2, 3];
  for (const b of kicksAt) {
    const t = bt(bar, b);
    kick(drums, t, { gain: studio ? 0.34 : 0.5, tone: studio ? 0.8 : 1 });
    kicks.push(t);
  }
  if (drop || build) for (const b of [1, 3]) clap(drums, bt(bar, b), { gain: 0.14, seed: bar * 10 + b });
  if (editor) clap(drums, bt(bar, 2), { gain: 0.12, seed: bar });
  for (let k = 0; k < 16; k++) {
    const b = k / 4;
    if (studio && bar !== 7 && k % 2 === 0) shaker(drums, bt(bar, b), { gain: k % 4 === 2 ? 0.035 : 0.022, seed: bar * 16 + k });
    if (drop || build) {
      if (k % 4 === 2) hat(drums, bt(bar, b), { gain: 0.05, open: k === 10, seed: bar * 16 + k });
      else hat(drums, bt(bar, b), { gain: 0.018, seed: bar * 16 + k, pan: -0.25 });
    }
    if (editor && k % 2 === 0) hat(drums, bt(bar, b), { gain: 0.03, seed: bar * 16 + k });
  }
  // Bass: long notes in the Studio and the editor, pumping eighths in the drop and the build.
  if (studio || editor) {
    bass(music, bt(bar, 0), s(BEAT) * 1.9, c.bass, { gain: 0.16 });
    bass(music, bt(bar, 2), s(BEAT) * 1.9, c.bass, { gain: 0.14 });
  } else {
    for (let k = 0; k < 4; k++) bass(music, bt(bar, k + 0.5), s(BEAT) * 0.45, c.bass + (k % 2 ? 12 : 0), { gain: 0.17 });
  }
  // The arpeggio: chord tones an octave up, sixteenths, through an echo.
  if (drop || build) {
    const tones = c.pad.map((m) => m + 12);
    const order = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 1, 3, 4, 3];
    for (let k = 0; k < 16; k++) {
      const m = tones[order[k]! % tones.length]!;
      pluck(echoSend, bt(bar, k / 4), m, {
        gain: k % 4 === 0 ? 0.05 : 0.035,
        cutoff: build ? 2400 + bar * 60 : 3000,
        pan: k % 2 ? 0.3 : -0.3,
      });
    }
  }
}
// A roll into the end.
for (let k = 0; k < 8; k++) clap(drums, bt(15, 2 + k / 4), { gain: 0.05 + k * 0.012, seed: 700 + k });
riser(sfx, bt(15), s(BAR) - 0.02, { gain: 0.1 });
kick(drums, bt(16), { gain: 0.55 });
kicks.push(bt(16));
impact(sfx, bt(16), { gain: 0.35 });
sparkle(verbSend, bt(16), 2.4, { gain: 0.02, density: 25, seed: 16 });

// The drop: a riser through bar 7 that stops dead as the screen goes black, then the hit.
const cutAt = s(SCENE.studio.at + STUDIO.whip[1]);
riser(sfx, bt(7), cutAt - bt(7), { gain: 0.11 });
impact(sfx, bt(8), { gain: 0.42 });
// The eight panels writing together: a short rise and a hit.
riser(sfx, at('plugins', PLUGINS.unison - 16), s(16), { gain: 0.06, seed: 51 });
impact(sfx, at('plugins', PLUGINS.unison), { gain: 0.2, seed: 52 });
whoosh(sfx, at('plugins', PLUGINS.unison), 1.2, { gain: 0.06, from: 6000, to: 1500, seed: 53 });

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

type Font = TegakiBundle;
const penAt = (
  scene: SceneId,
  font: Font,
  text: string,
  when: { from: number; frames?: number; speed?: number },
  o: { gain?: number; pan?: number; tone?: PenTone; until?: number; mark?: [delay: number, dur: number]; seed?: number } = {},
) => {
  let p = strokesOf(text, font);
  const length = p.length;
  if (o.mark) p = withMark(p, o.mark[0], o.mark[1]);
  const base = SCENE[scene].at;
  const from = base + when.from;
  const clock = when.frames !== undefined ? framesClock(from, when.frames, length) : speedClock(from, when.speed ?? 1, FPS);
  const end = when.frames !== undefined ? from + (when.frames * p.length) / length + 2 : from + (p.length / (when.speed ?? 1)) * FPS + 2;
  pen(sfx, {
    strokes: p.strokes,
    clock,
    from,
    to: Math.min(o.until !== undefined ? base + o.until : end, end, base + SCENE[scene].frames),
    fps: FPS,
    gain: o.gain,
    pan: o.pan,
    tone: o.tone,
    seed: o.seed ?? Math.round(from),
  });
  return { from, end };
};

// Title: the kanji brushed, the name in a hot pen with sparks, the version circled.
penAt('title', kleeOne, '手書き', TITLE.kanji, { gain: 0.05, tone: TONES.brush });
const name = penAt('title', caveat, 'tegaki', TITLE.name, { gain: 0.11, tone: TONES.marker });
sparkle(sfx, s(name.from), s(name.end - name.from), { gain: 0.012, density: 30, seed: 21 });
penAt('title', caveat, '1.0', TITLE.version, { gain: 0.08, tone: TONES.marker, mark: [0.1, 0.55], pan: 0.35 });
bell(verbSend, at('title', TITLE.tagline), 86, { gain: 0.04, decay: 2, ratio: 2, index: 0.6 });
whoosh(sfx, at('title', WIPES.titleOut.at), s(WIPES.titleOut.dur) + 0.15, { gain: 0.2, from: 300, to: 2500 });

// Scripts: each card lands with a note, rippling out, and writes.
const CELLS: [Font, string, number, number][] = [
  [parisienne, 'bonjour', 0, 0],
  [kleeOne, 'こんにちは', 0, 1],
  [amiri, 'مرحبا', 0, 2],
  [tillana, 'नमस्ते', 0, 3],
  [tangerine, 'hola', 1, 0],
  [caveat, 'hello', 1, 1],
  [lxgwWenkai, '你好', 1, 2],
  [nanumPenScript, '반가워요', 1, 3],
  [suezOne, 'שלום', 2, 0],
  [atma, 'নমস্কার', 2, 1],
  [italianno, 'ciao', 2, 2],
  [hersheyScript, 'hallo', 2, 3],
];
const PENTATONIC = [74, 76, 78, 81, 83, 86, 88, 90];
const byDistance = CELLS.map(([, , r, c]) => Math.hypot(r - 1, c - 1));
const ranks = [...new Set(byDistance.map((d) => d.toFixed(3)))].sort((a, b) => Number(a) - Number(b));
CELLS.forEach(([font, text, r, c], i) => {
  const d = byDistance[i]!;
  const from = SCRIPTS.rippleAt + d * SCRIPTS.rippleStep;
  const pan = (c - 1.5) * 0.45;
  if (d > 0) {
    tap(sfx, at('scripts', from - 3), { gain: 0.05, pan, seed: 100 + i });
    bell(echoSend, at('scripts', from - 3), PENTATONIC[ranks.indexOf(d.toFixed(3)) + 1]!, { gain: 0.035, decay: 0.9, pan });
  }
  penAt(
    'scripts',
    font,
    text,
    { from, frames: SCRIPTS.writeFrames },
    { gain: d === 0 ? 0.08 : 0.028, pan, tone: r === 1 && c === 1 ? TONES.marker : TONES.pencil },
  );
});
bell(verbSend, at('scripts', SCRIPTS.tagline), 81, { gain: 0.03, decay: 2, ratio: 2, index: 0.5 });

// Studio: the window rising, clicks where the cursor clicks, the glyph written, both texts.
whoosh(sfx, at('studio', 0), 0.7, { gain: 0.1, from: 500, to: 1800, panFrom: 0, panTo: 0 });
for (const f of [STUDIO.skeleton, STUDIO.strokes, STUDIO.final, STUDIO.text, STUDIO.pluginsTab]) click(sfx, at('studio', f), { gain: 0.1 });
sparkle(sfx, at('studio', STUDIO.skeleton), 0.5, { gain: 0.012, density: 30, seed: 31 });
for (let i = 0; i < 5; i++) bell(echoSend, at('studio', STUDIO.strokes + i * 6), [74, 78, 81, 86, 88][i]!, { gain: 0.025, decay: 0.6 });
click(sfx, at('studio', STUDIO.picker), { gain: 0.1, tone: 1800, pan: -0.5 });
whoosh(sfx, at('studio', STUDIO.picker), 0.18, { gain: 0.04, from: 2000, to: 5000, panFrom: -0.5, panTo: -0.5 });
click(sfx, at('studio', STUDIO.parisienne), { gain: 0.1, tone: 2000, pan: -0.5 });
for (const f of [STUDIO.rainbow, STUDIO.glow, STUDIO.boil]) {
  click(sfx, at('studio', f), { gain: 0.09, tone: 1500, pan: 0.6 });
  click(sfx, at('studio', f + 3), { gain: 0.06, tone: 2600, pan: 0.6 });
}
sparkle(sfx, at('studio', STUDIO.rainbow + 1), 0.4, { gain: 0.015, density: 40, seed: 32, pan: -0.2 });
const E = (caveat.glyphData as Record<string, TegakiGlyphData>).E!;
pen(sfx, {
  strokes: glyphStrokes(E),
  clock: (f) => (f < SCENE.studio.at + STUDIO.final ? null : ((f - SCENE.studio.at - STUDIO.final) / 30) * 1.1),
  from: SCENE.studio.at + STUDIO.final,
  to: SCENE.studio.at + STUDIO.text,
  fps: FPS,
  gain: 0.1,
  pan: -0.1,
});
penAt(
  'studio',
  caveat,
  'Make it yours',
  { from: STUDIO.text + 4, frames: STUDIO.writeFrames },
  { gain: 0.08, until: STUDIO.parisienne, pan: -0.2 },
);
penAt(
  'studio',
  parisienne,
  'Make it yours',
  { from: STUDIO.parisienne + 2, frames: STUDIO.writeFrames },
  { gain: 0.07, tone: TONES.nib, pan: -0.2 },
);
whoosh(sfx, at('studio', STUDIO.whip[0]), s(STUDIO.whip[1] - STUDIO.whip[0]), { gain: 0.22, from: 300, to: 6000, panFrom: 0, panTo: 0 });

// Plugins: every panel sounds like what it's made of.
const PANEL_PAN = [-0.75, 0.25, -0.75, 0.25, -0.25, 0.75, -0.25, 0.75];
const panelEnd = SCENE.plugins.frames - 20;
const panelSound = (i: number, from: number, frames: number, gain: number) => {
  const pan = from === PLUGINS.appear[0] ? 0 : PANEL_PAN[i]!;
  const when = { from, frames };
  const t0 = at('plugins', from);
  const dur = s(frames) + 0.4;
  switch (i) {
    case 0: // neon: no scratch, a zap as each tube lights, and the hum
      for (const st of strokesOf('magic', caveat).strokes) {
        const f = from + (st.start / strokesOf('magic', caveat).length) * frames;
        click(sfx, at('plugins', f), { gain: gain * 0.9, tone: 3200, pan });
      }
      break;
    case 1:
      penAt('plugins', caveat, 'magic', when, { gain: gain * 1.4, tone: TONES.chalk, pan, until: panelEnd });
      break;
    case 2:
      penAt('plugins', caveat, 'magic', when, { gain, tone: TONES.nib, pan, until: panelEnd });
      sparkle(sfx, t0, dur, { gain: gain * 0.15, density: 20, pan, seed: 60 + from });
      break;
    case 3:
      crackle(sfx, t0, dur + 0.8, { gain: gain * 0.35, pan, seed: 70 + from });
      break;
    case 4:
      penAt('plugins', caveat, 'magic', when, { gain: gain * 0.8, tone: TONES.pencil, pan, until: panelEnd });
      break;
    case 5:
      penAt('plugins', caveat, 'magic', when, { gain: gain * 1.2, tone: TONES.brush, pan, until: panelEnd });
      break;
    case 6:
      blips(sfx, t0, dur, { gain: gain * 0.25, pan, seed: 80 + from });
      break;
    case 7:
      sparkle(sfx, t0, dur, { gain: gain * 0.2, density: 45, pan, seed: 90 + from });
      break;
  }
};
neonHum(sfx, at('plugins', 0), s(PLUGINS.splits[0]! + 10), { gain: 0.035 });
for (const [i, from] of PLUGINS.appear.entries()) panelSound(i, from, PLUGINS.writeFrames, i === 0 ? 0.1 : i < 4 ? 0.07 : 0.04);
for (let i = 0; i < 8; i++) panelSound(i, PLUGINS.unison, PLUGINS.unisonFrames, 0.035);
PLUGINS.splits.forEach((f, k) => {
  whoosh(sfx, at('plugins', f), s(PLUGINS.splitFrames) + 0.1, { gain: 0.14, from: 600, to: 3500, seed: 40 + k, panFrom: -0.4, panTo: 0.4 });
  kick(sfx, at('plugins', f + PLUGINS.splitFrames - 2), { gain: 0.12, tone: 0.6 });
});
whoosh(sfx, at('plugins', SCENE.plugins.frames - 32), 0.8, { gain: 0.12, from: 3000, to: 300, seed: 48, panFrom: 0, panTo: 0 });

// Video: the title writes with the playhead — scratching backwards when it's dragged back —
// the scrub itself, clicks, the render ticking and a chime when it's done.
const vAt = SCENE.video.at;
for (const [font, text, t0, secs, gain, tone] of [
  [parisienne, 'Kyoto, day one', VIDEO.titleAt, VIDEO.titleSeconds, 0.09, TONES.nib],
  [caveat, 'the city hums at dusk', VIDEO.subAt, VIDEO.subSeconds, 0.05, TONES.marker],
] as const) {
  const p = strokesOf(text, font);
  pen(sfx, {
    strokes: p.strokes,
    clock: (f) => Math.max(0, Math.min(1, (playhead(f - vAt) - t0) / secs)) * p.length,
    from: vAt,
    to: vAt + SCENE.video.frames,
    fps: FPS,
    gain,
    tone,
    pan: -0.3,
  });
}
{
  // Tape scrub: band-passed noise that rises and falls with the playhead's speed.
  const bp = new Biquad();
  let seed = 12345;
  const from = sec(s(vAt + VIDEO.grab));
  const to = sec(s(vAt + VIDEO.drop));
  for (let i = from; i < to; i++) {
    const f = (i / SR) * FPS - vAt;
    const v = Math.abs(playhead(f + 0.5) - playhead(f - 0.5)) * FPS;
    if ((i - from) % 32 === 0) bp.set('bp', 300 + v * 500, 1.6);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    sfx.add(i, bp.run(seed / 2 ** 31 - 1) * Math.min(1, v / 3) * 0.12, 0.2);
  }
}
click(sfx, at('video', VIDEO.grab), { gain: 0.1, tone: 1700, pan: 0.2 });
click(sfx, at('video', VIDEO.drop), { gain: 0.08, tone: 2300, pan: 0.2 });
click(sfx, at('video', VIDEO.render), { gain: 0.12, tone: 1900, pan: 0.5 });
for (let f = VIDEO.render + 2; f < VIDEO.rendered; f += 2) click(sfx, at('video', f), { gain: 0.025, tone: 4200, pan: 0.5 });
for (const [k, m] of [74, 78, 81, 86].entries())
  bell(verbSend, at('video', VIDEO.rendered) + k * 0.06, m, { gain: 0.06, decay: 1.2, pan: 0.5 });

// Everywhere: the page sliding up, the tiles landing, each written, the chips ticking in.
whoosh(sfx, at('everywhere', 0), 0.5, { gain: 0.16, from: 250, to: 1600, panFrom: 0, panTo: 0 });
for (const [i, f] of EVERYWHERE.tiles.entries()) tap(sfx, at('everywhere', f + 6), { gain: 0.06, pan: -0.6 + i * 0.4, seed: 200 + i });
penAt('everywhere', parisienne, 'Welcome home', EVERYWHERE.web, { gain: 0.05, tone: TONES.nib, pan: -0.6 });
penAt('everywhere', caveat, 'ink finds the paper\neach stroke a heartbeat\nwords learn to breathe', EVERYWHERE.chat, {
  gain: 0.035,
  tone: TONES.pencil,
  pan: -0.2,
});
penAt('everywhere', kleeOne, '書', EVERYWHERE.learn, { gain: 0.05, tone: TONES.brush, pan: 0.2 });
penAt('everywhere', parisienne, 'Happy birthday,\nMia', EVERYWHERE.card, { gain: 0.04, tone: TONES.nib, pan: 0.6 });
sparkle(sfx, at('everywhere', EVERYWHERE.card.from), s(EVERYWHERE.card.frames), { gain: 0.008, density: 15, pan: 0.6, seed: 210 });
for (let i = 0; i < 10; i++)
  click(sfx, at('everywhere', EVERYWHERE.chips + i * EVERYWHERE.chipStep + 2), { gain: 0.025, tone: 3000 + i * 150, pan: -0.6 + i * 0.13 });
whoosh(sfx, at('everywhere', WIPES.everywhereOut.at), s(WIPES.everywhereOut.dur) + 0.15, { gain: 0.2, from: 2500, to: 300, seed: 220 });

// Outro: the name once more, the version circled, the install typed, the signature.
const outroName = penAt('outro', caveat, 'tegaki', OUTRO.name, { gain: 0.1 });
sparkle(sfx, s(outroName.from), s(outroName.end - outroName.from), { gain: 0.012, density: 30, seed: 230 });
penAt('outro', caveat, '1.0', OUTRO.version, { gain: 0.07, mark: [0.05, 0.45], pan: 0.35 });
[...OUTRO.typing.text].forEach((ch, i) => {
  if (ch !== ' ') key(sfx, at('outro', OUTRO.typing.at + (i * FPS) / OUTRO.typing.cps + 0.5), { gain: 0.07, seed: 300 + i });
});
penAt('outro', caveat, 'every handwritten letter here was drawn by tegaki', OUTRO.sign, {
  gain: 0.06,
  mark: [0.1, 0.4],
  tone: TONES.pencil,
});

// ---------------------------------------------------------------------------
// Mix
// ---------------------------------------------------------------------------

// The sidechain: the music ducks under each kick.
const duck = new Float32Array(LENGTH).fill(1);
for (const k of kicks) {
  const i0 = sec(k);
  for (let i = 0; i < sec(0.3); i++) {
    const j = i0 + i;
    if (j >= LENGTH) break;
    duck[j] = Math.min(duck[j]!, 1 - 0.5 * Math.exp(-i / SR / 0.09));
  }
}
// Everything musical stops for the black frames before the drop.
const gate = (i: number) => {
  const t = i / SR;
  const a = cutAt;
  const b = bt(8);
  if (t < a - 0.03 || t >= b) return 1;
  if (t < a) return (a - t) / 0.03;
  return 0;
};
// While the playhead is dragged, the music sinks under water.
const scrubFrom = at('video', VIDEO.grab);
const scrubTo = at('video', VIDEO.drop);
const muffle = (t: number) => {
  if (t < scrubFrom - 0.1 || t > scrubTo + 0.3) return 0;
  const inn = Math.min(1, (t - (scrubFrom - 0.1)) / 0.15);
  const out = Math.min(1, (scrubTo + 0.3 - t) / 0.3);
  return Math.min(inn, out);
};

const beatSeconds = s(BEAT);
const echo2 = pingPong(echoSend, beatSeconds * 0.75, 0.35);
const musicMix = new Bus(LENGTH);
music.mixInto(musicMix, 1, (i) => duck[i]! * gate(i));
echoSend.mixInto(musicMix, 1, (i) => (0.6 + 0.4 * duck[i]!) * gate(i));
echo2.mixInto(musicMix, 0.45, gate);
drums.mixInto(musicMix, 1, gate);
{
  const fl = new Biquad();
  const fr = new Biquad();
  for (let i = 0; i < LENGTH; i++) {
    if (i % 64 === 0) {
      const m = muffle(i / SR);
      const f = 18000 * (1 - m) + 700 * m;
      fl.set('lp', f, 0.7);
      fr.set('lp', f, 0.7);
    }
    const m = muffle(i / SR);
    musicMix.l[i] = fl.run(musicMix.l[i]!) * (1 - 0.35 * m);
    musicMix.r[i] = fr.run(musicMix.r[i]!) * (1 - 0.35 * m);
  }
}

// Reverb for the whole mix, fed by the music, a little of the effects, and the sends.
const send = new Bus(LENGTH);
musicMix.mixInto(send, 0.35);
sfx.mixInto(send, 0.3);
verbSend.mixInto(send, 1.2);
echoSend.mixInto(send, 0.8, gate);
const hall = reverb(send, { room: 0.88, damp: 0.4 });

const master = new Bus(LENGTH);
musicMix.mixInto(master, 0.85);
sfx.mixInto(master, 1);
verbSend.mixInto(master, 0.6);
hall.mixInto(master, 0.9);

// Clear the rumble under 30 Hz that small speakers only muddy.
{
  const hp = [new Biquad().set('hp', 30), new Biquad().set('hp', 30), new Biquad().set('hp', 30), new Biquad().set('hp', 30)];
  for (let i = 0; i < LENGTH; i++) {
    master.l[i] = hp[1]!.run(hp[0]!.run(master.l[i]!));
    master.r[i] = hp[3]!.run(hp[2]!.run(master.r[i]!));
  }
}
// A look-ahead limiter: the kicks and hits stop setting the level, so the rest can come up.
{
  let p = 0;
  for (let i = 0; i < LENGTH; i++) p = Math.max(p, Math.abs(master.l[i]!), Math.abs(master.r[i]!));
  const threshold = p * 0.66;
  const look = sec(0.004);
  const release = Math.exp(-1 / sec(0.12));
  const need = new Float32Array(LENGTH);
  for (let i = 0; i < LENGTH; i++) {
    const a = Math.max(Math.abs(master.l[i]!), Math.abs(master.r[i]!));
    need[i] = a > threshold ? threshold / a : 1;
  }
  // The gain each sample needs, reached `look` samples early and let go slowly.
  const gain = new Float32Array(LENGTH);
  let g = 1;
  for (let i = LENGTH - 1; i >= 0; i--) {
    let m = need[i]!;
    for (let j = 1; j <= look && i + j < LENGTH; j += 8) m = Math.min(m, need[i + j]!);
    gain[i] = m;
  }
  for (let i = 0; i < LENGTH; i++) {
    g = gain[i]! < g ? gain[i]! : g * release + (1 - release) * gain[i]!;
    master.l[i]! *= g;
    master.r[i]! *= g;
  }
}

// Soft-clip, then normalize to -2.8 dBFS (about -14 LUFS, where video sites play it); fade in over the first frames and out at the end.
let peak = 0;
for (let i = 0; i < LENGTH; i++) {
  master.l[i] = Math.tanh(master.l[i]! * 1.1);
  master.r[i] = Math.tanh(master.r[i]! * 1.1);
  peak = Math.max(peak, Math.abs(master.l[i]!), Math.abs(master.r[i]!));
}
const norm = 10 ** (-2.8 / 20) / Math.max(peak, 1e-6);
const fadeOut = sec(0.8);
for (let i = 0; i < LENGTH; i++) {
  const g = norm * Math.min(1, i / sec(0.05)) * Math.min(1, (LENGTH - i) / fadeOut);
  master.l[i]! *= g;
  master.r[i]! *= g;
}

// Loudness by scene, to check the balance.
for (const [id, sc] of Object.entries(SCENE)) {
  const a = sec(s(sc.at));
  const b = Math.min(LENGTH, sec(s(sc.at + sc.frames)));
  let sum = 0;
  for (let i = a; i < b; i++) sum += master.l[i]! ** 2 + master.r[i]! ** 2;
  console.log(`${id.padEnd(11)} ${(10 * Math.log10(sum / ((b - a) * 2))).toFixed(1)} dBFS RMS`);
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/launch-soundtrack.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, wav(master));
console.log(`wrote ${out} (${(DURATION / FPS).toFixed(2)}s)`);
