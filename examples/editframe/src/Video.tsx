import { Text, Timegroup } from '@editframe/react';
import { type CSSProperties, type ElementRef, type RefObject, useEffect, useRef } from 'react';
import type { TegakiBundle, TegakiEngine } from 'tegaki/react';
import { fonts } from './fonts';
import { Ink } from './Handwriting';

/* ------------------------------------------------------------------ helpers */

const QUALITY = { pixelRatio: 2, smoothing: true } as const;

// White ink + a soft halo — reads beautifully on the vivid gradient scenes.
const WHITE_INK = {
  pressureWidth: { strength: 1.4 },
  glow: { radius: '14px', color: 'rgba(255,255,255,0.5)' },
} as const;

// Colored ink for the "paper" multi-script panel.
const inkGradient = (colors: string[]) => ({
  pressureWidth: { strength: 1.4 },
  strokeGradient: { colors },
});

/**
 * Crossfade the whole scene in CSS (not JS timing) so it survives export. The
 * out-phase is anchored to `--ef-transition-out-start`, which editframe sets on
 * each scene timegroup from the sequence's `overlapMs`.
 */
const SCENE_FADE: CSSProperties = {
  animation: 'sceneIn 0.4s ease-out both, sceneOut 0.4s ease-in var(--ef-transition-out-start) both',
};

/**
 * Map a scene's 0–1 progress onto a word's 0–1 writing progress across a
 * sub-window `[start, end]`. Before `start` nothing is drawn; after `end` the
 * word is fully written and holds. Driving Tegaki purely by progress means a
 * word always finishes writing at `end` of the scene, whatever its intrinsic
 * stroke duration.
 */
function writeWindow(pct: number, start: number, end: number) {
  return Math.max(0, Math.min(1, (pct - start) / (end - start)));
}

type TimegroupEl = ElementRef<typeof Timegroup>;

/**
 * editframe's per-frame hook lives on the timegroup element but isn't in its
 * public d.ts. The callback receives one frame-info object (not positional
 * args); `percentComplete` is the scene's 0–1 playback position.
 */
type FrameInfo = { ownCurrentTimeMs: number; durationMs: number; percentComplete: number };
type FrameTaskHost = {
  addFrameTask?: (cb: (frame: FrameInfo) => void) => void;
  removeFrameTask?: (cb: (frame: FrameInfo) => void) => void;
};

/**
 * Drive every Tegaki word in a scene from editframe's `addFrameTask`, which
 * fires synchronously on every rendered frame — in the preview *and*, crucially,
 * during export. Each frame we push the word's writing progress straight into
 * the engine via `update({ time })`, which redraws the canvas synchronously so
 * the export capture sees it. `windows[i]` is engine `i`'s `[start, end]`
 * progress sub-range within the scene.
 */
function useInkFrameDriver(
  tgRef: RefObject<TimegroupEl | null>,
  enginesRef: RefObject<(TegakiEngine | null)[]>,
  windows: readonly (readonly [number, number])[],
) {
  useEffect(() => {
    const host = tgRef.current as unknown as FrameTaskHost | null;
    if (!host?.addFrameTask) return;
    const task = ({ percentComplete }: FrameInfo) => {
      const engines = enginesRef.current ?? [];
      for (let i = 0; i < windows.length; i++) {
        const [start, end] = windows[i];
        engines[i]?.update({
          time: { mode: 'controlled', value: writeWindow(percentComplete, start, end), unit: 'progress' },
        });
      }
    };
    host.addFrameTask(task);
    return () => host.removeFrameTask?.(task);
  }, [tgRef, enginesRef, windows]);
}

/* -------------------------------------------------------------------- scenes */

/** 1 — Wordmark. "Tegaki" writes itself, then the tagline fades up. */
const INTRO_WINDOWS = [[0.05, 0.62]] as const;

const SceneIntro = () => {
  const tg = useRef<TimegroupEl>(null);
  const engines = useRef<(TegakiEngine | null)[]>([]);
  useInkFrameDriver(tg, engines, INTRO_WINDOWS);

  return (
    <Timegroup
      ref={tg}
      mode="fixed"
      duration="4.5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400"
    >
      <div style={SCENE_FADE} className="flex flex-col items-center">
        <Ink
          onEngine={(e) => {
            engines.current[0] = e;
          }}
          font={fonts.caveat}
          text="Tegaki"
          effects={WHITE_INK}
          quality={QUALITY}
          style={{ fontSize: 260, color: 'white', lineHeight: 1 }}
        />
        <Text
          duration="4.5s"
          className="mt-2 text-white/90 text-5xl font-light tracking-tight"
          style={{ opacity: 0, animation: 'fadeUp 0.8s ease-out both', animationDelay: '1.6s' }}
        >
          handwriting, animated.
        </Text>
      </div>
    </Timegroup>
  );
};

/** 2 — The hook: one big word drawn stroke-by-stroke, slow enough to admire. */
const HERO_WINDOWS = [[0.12, 0.78]] as const;

const SceneHero = () => {
  const tg = useRef<TimegroupEl>(null);
  const engines = useRef<(TegakiEngine | null)[]>([]);
  useInkFrameDriver(tg, engines, HERO_WINDOWS);

  return (
    <Timegroup
      ref={tg}
      mode="fixed"
      duration="5.5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400"
    >
      <div style={SCENE_FADE} className="flex flex-col items-center">
        <Text
          duration="5.5s"
          className="mb-2 text-white/85 text-4xl font-medium tracking-wide"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both', animationDelay: '0.2s' }}
        >
          every stroke, in order, drawn by hand
        </Text>
        <Ink
          onEngine={(e) => {
            engines.current[0] = e;
          }}
          font={fonts.italianno}
          text="Hello!"
          effects={WHITE_INK}
          quality={QUALITY}
          style={{ fontSize: 320, color: 'white', lineHeight: 1 }}
        />
      </div>
    </Timegroup>
  );
};

/** 3 — Multi-script: greetings in four writing systems on a clean paper panel. */
type ScriptRow = { font: TegakiBundle; text: string; label: string; colors: string[]; start: number; direction?: 'ltr' | 'rtl' };
const SCRIPT_ROWS: ScriptRow[] = [
  { font: fonts.caveat, text: 'Hello', label: 'Latin', colors: ['#d946ef', '#ec4899'], start: 0.05 },
  { font: fonts.kleeOne, text: 'こんにちは', label: '日本語', colors: ['#0ea5e9', '#06b6d4'], start: 0.18 },
  { font: fonts.nanumPenScript, text: '안녕하세요', label: '한국어', colors: ['#f59e0b', '#f97316'], start: 0.31 },
  { font: fonts.suezOne, text: 'שלום', label: 'עברית', colors: ['#7c3aed', '#8b5cf6'], start: 0.44, direction: 'rtl' },
];
const SCRIPT_WINDOWS = SCRIPT_ROWS.map((r) => [r.start, r.start + 0.38] as const);

const SceneScripts = () => {
  const tg = useRef<TimegroupEl>(null);
  const engines = useRef<(TegakiEngine | null)[]>([]);
  useInkFrameDriver(tg, engines, SCRIPT_WINDOWS);

  return (
    <Timegroup
      ref={tg}
      mode="fixed"
      duration="8s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-200"
    >
      <div style={SCENE_FADE} className="flex flex-col items-center w-full">
        <Text
          duration="8s"
          className="mb-10 text-slate-800 text-5xl font-semibold"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both' }}
        >
          Any language. Any script.
        </Text>
        <div className="grid grid-cols-2 gap-x-24 gap-y-6 items-center">
          {SCRIPT_ROWS.map((r, i) => (
            <div key={r.label} className="flex items-center justify-center gap-6 h-40">
              <Ink
                onEngine={(e) => {
                  engines.current[i] = e;
                }}
                font={r.font}
                text={r.text}
                direction={r.direction}
                effects={inkGradient([...r.colors])}
                quality={QUALITY}
                style={{ fontSize: 120, lineHeight: 1 }}
              />
            </div>
          ))}
        </div>
      </div>
    </Timegroup>
  );
};

/** 4 — Bring your own font: the same word, three fonts, drawn together. */
const ANYFONT_LINES = [
  { font: fonts.caveat, label: 'Caveat', size: 140 },
  { font: fonts.italianno, label: 'Italianno', size: 170 },
  { font: fonts.tangerine, label: 'Tangerine', size: 170 },
] as const;
const ANYFONT_WINDOWS = ANYFONT_LINES.map((_, i) => [0.1 + i * 0.06, 0.8] as const);

const SceneAnyFont = () => {
  const tg = useRef<TimegroupEl>(null);
  const engines = useRef<(TegakiEngine | null)[]>([]);
  useInkFrameDriver(tg, engines, ANYFONT_WINDOWS);

  return (
    <Timegroup
      ref={tg}
      mode="fixed"
      duration="5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-rose-500 via-pink-500 to-purple-600"
    >
      <div style={SCENE_FADE} className="flex flex-col items-center">
        <Text
          duration="5s"
          className="mb-8 text-white text-5xl font-semibold"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both' }}
        >
          Bring your own font.
        </Text>
        <div className="flex flex-col items-center gap-2">
          {ANYFONT_LINES.map((l, i) => (
            <div key={l.label} className="flex items-center gap-8">
              <span className="w-40 text-right text-white/60 text-2xl font-mono">{l.label}</span>
              <Ink
                onEngine={(e) => {
                  engines.current[i] = e;
                }}
                font={l.font}
                text="beautiful"
                effects={WHITE_INK}
                quality={QUALITY}
                style={{ fontSize: l.size, color: 'white', lineHeight: 1 }}
              />
            </div>
          ))}
        </div>
      </div>
    </Timegroup>
  );
};

/** 5 — Outro: 手書き ("tegaki" = handwriting) + install line and adapters. */
const OUTRO_WINDOWS = [[0.05, 0.5]] as const;

const SceneOutro = () => {
  const tg = useRef<TimegroupEl>(null);
  const engines = useRef<(TegakiEngine | null)[]>([]);
  useInkFrameDriver(tg, engines, OUTRO_WINDOWS);

  return (
    <Timegroup
      ref={tg}
      mode="fixed"
      duration="5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-700 via-purple-600 to-fuchsia-500"
    >
      <div style={SCENE_FADE} className="flex flex-col items-center">
        <Ink
          onEngine={(e) => {
            engines.current[0] = e;
          }}
          font={fonts.kleeOne}
          text="手書き"
          effects={WHITE_INK}
          quality={QUALITY}
          style={{ fontSize: 240, color: 'white', lineHeight: 1 }}
        />
        <Text
          duration="5s"
          className="mt-4 px-6 py-3 rounded-2xl bg-black/30 text-white text-4xl font-mono"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both', animationDelay: '1.4s' }}
        >
          npm i tegaki
        </Text>
        <Text
          duration="5s"
          className="mt-5 text-white/80 text-2xl tracking-wide"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both', animationDelay: '2s' }}
        >
          React · Svelte · Vue · Solid · Astro · Web Components
        </Text>
      </div>
    </Timegroup>
  );
};

/* --------------------------------------------------------------------- video */

export const Video = () => {
  return (
    <Timegroup workbench mode="sequence" overlapMs={500} className="w-[1920px] h-[1080px] bg-black relative overflow-hidden">
      <SceneIntro />
      <SceneHero />
      <SceneScripts />
      <SceneAnyFont />
      <SceneOutro />
    </Timegroup>
  );
};
