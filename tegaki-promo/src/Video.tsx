import { Text, Timegroup, useTimingInfo } from '@editframe/react';
import type React from 'react';
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
 * Map a scene's 0–1 progress onto a word's 0–1 writing progress across a
 * sub-window `[start, end]`. Before `start` nothing is drawn; after `end` the
 * word is fully written and holds. This is what lets us drive Tegaki purely by
 * progress — the word always finishes writing at `end` of the scene, whatever
 * its intrinsic stroke duration.
 */
function writeWindow(pct: number, start: number, end: number) {
  return Math.max(0, Math.min(1, (pct - start) / (end - start)));
}

/** Opacity envelope: fade in over the first `fade`s, out over the last `fade`s. */
function edgeFade(t: number, dur: number, fade = 0.45) {
  return Math.max(0, Math.min(1, t / fade, (dur - t) / fade));
}

/**
 * `useTimingInfo()` returns a React-19-style `RefObject<EFTimegroup | null>`,
 * but this project pins React 18 types whose `<Timegroup ref>` prop rejects the
 * `| null`. Runtime is unaffected; this reconciles the types skew in one place
 * (the element type is derived from `Timegroup`, so no extra import is needed).
 */
function useSceneTiming() {
  const info = useTimingInfo();
  return { ...info, ref: info.ref as React.Ref<React.ElementRef<typeof Timegroup>> };
}

/* -------------------------------------------------------------------- scenes */

/** 1 — Wordmark. "Tegaki" writes itself, then the tagline fades up. */
const SceneIntro = () => {
  const { ref, ownCurrentTimeMs, durationMs, percentComplete } = useSceneTiming();
  const t = ownCurrentTimeMs / 1000;
  const dur = durationMs / 1000;
  return (
    <Timegroup
      ref={ref}
      mode="fixed"
      duration="4.5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400"
    >
      <div style={{ opacity: edgeFade(t, dur) }} className="flex flex-col items-center">
        <Ink
          font={fonts.caveat}
          text="Tegaki"
          progress={writeWindow(percentComplete, 0.05, 0.62)}
          effects={WHITE_INK}
          quality={QUALITY}
          style={{ fontSize: 260, color: 'white', lineHeight: 1 }}
        />
        <Text
          duration="4.5s"
          className="mt-2 text-white/90 text-5xl font-light tracking-tight"
          style={{
            opacity: 0,
            animation: 'fadeUp 0.8s ease-out both',
            animationDelay: '1.6s',
          }}
        >
          handwriting, animated.
        </Text>
      </div>
    </Timegroup>
  );
};

/** 2 — The hook: one big word drawn stroke-by-stroke, slow enough to admire. */
const SceneHero = () => {
  const { ref, ownCurrentTimeMs, durationMs, percentComplete } = useSceneTiming();
  const t = ownCurrentTimeMs / 1000;
  const dur = durationMs / 1000;
  return (
    <Timegroup
      ref={ref}
      mode="fixed"
      duration="5.5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400"
    >
      <div style={{ opacity: edgeFade(t, dur) }} className="flex flex-col items-center">
        <Text
          duration="5.5s"
          className="mb-2 text-white/85 text-4xl font-medium tracking-wide"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both', animationDelay: '0.2s' }}
        >
          every stroke, in order, drawn by hand
        </Text>
        <Ink
          font={fonts.parisienne}
          text="Hello!"
          progress={writeWindow(percentComplete, 0.12, 0.78)}
          effects={WHITE_INK}
          quality={QUALITY}
          style={{ fontSize: 300, color: 'white', lineHeight: 1 }}
        />
      </div>
    </Timegroup>
  );
};

/** 3 — Multi-script: greetings in four writing systems on a clean paper panel. */
const SceneScripts = () => {
  const { ref, ownCurrentTimeMs, durationMs, percentComplete } = useSceneTiming();
  const t = ownCurrentTimeMs / 1000;
  const dur = durationMs / 1000;

  const rows: {
    font: (typeof fonts)[keyof typeof fonts];
    text: string;
    label: string;
    colors: string[];
    start: number;
    direction?: 'ltr' | 'rtl';
  }[] = [
    { font: fonts.caveat, text: 'Hello', label: 'Latin', colors: ['#d946ef', '#ec4899'], start: 0.05 },
    { font: fonts.kleeOne, text: 'こんにちは', label: '日本語', colors: ['#0ea5e9', '#06b6d4'], start: 0.18 },
    { font: fonts.nanumPenScript, text: '안녕하세요', label: '한국어', colors: ['#f59e0b', '#f97316'], start: 0.31 },
    { font: fonts.suezOne, text: 'שלום', label: 'עברית', colors: ['#7c3aed', '#8b5cf6'], start: 0.44, direction: 'rtl' },
  ];

  return (
    <Timegroup
      ref={ref}
      mode="fixed"
      duration="8s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-200"
    >
      <div style={{ opacity: edgeFade(t, dur) }} className="flex flex-col items-center w-full">
        <Text
          duration="8s"
          className="mb-10 text-slate-800 text-5xl font-semibold"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both' }}
        >
          Any language. Any script.
        </Text>
        <div className="grid grid-cols-2 gap-x-24 gap-y-6 items-center">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-center gap-6 h-40">
              <Ink
                font={r.font}
                text={r.text}
                direction={r.direction}
                progress={writeWindow(percentComplete, r.start, r.start + 0.38)}
                effects={inkGradient(r.colors)}
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
const SceneAnyFont = () => {
  const { ref, ownCurrentTimeMs, durationMs, percentComplete } = useSceneTiming();
  const t = ownCurrentTimeMs / 1000;
  const dur = durationMs / 1000;

  const lines: { font: (typeof fonts)[keyof typeof fonts]; label: string; size: number }[] = [
    { font: fonts.caveat, label: 'Caveat', size: 140 },
    { font: fonts.parisienne, label: 'Parisienne', size: 150 },
    { font: fonts.tangerine, label: 'Tangerine', size: 170 },
  ];

  return (
    <Timegroup
      ref={ref}
      mode="fixed"
      duration="5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-rose-500 via-pink-500 to-purple-600"
    >
      <div style={{ opacity: edgeFade(t, dur) }} className="flex flex-col items-center">
        <Text
          duration="5s"
          className="mb-8 text-white text-5xl font-semibold"
          style={{ opacity: 0, animation: 'fadeUp 0.7s ease-out both' }}
        >
          Bring your own font.
        </Text>
        <div className="flex flex-col items-center gap-2">
          {lines.map((l, i) => (
            <div key={l.label} className="flex items-center gap-8">
              <span className="w-40 text-right text-white/60 text-2xl font-mono">{l.label}</span>
              <Ink
                font={l.font}
                text="beautiful"
                progress={writeWindow(percentComplete, 0.1 + i * 0.06, 0.8)}
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
const SceneOutro = () => {
  const { ref, ownCurrentTimeMs, durationMs, percentComplete } = useSceneTiming();
  const t = ownCurrentTimeMs / 1000;
  const dur = durationMs / 1000;
  return (
    <Timegroup
      ref={ref}
      mode="fixed"
      duration="5s"
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-700 via-purple-600 to-fuchsia-500"
    >
      <div style={{ opacity: edgeFade(t, dur) }} className="flex flex-col items-center">
        <Ink
          font={fonts.kleeOne}
          text="手書き"
          progress={writeWindow(percentComplete, 0.05, 0.5)}
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
