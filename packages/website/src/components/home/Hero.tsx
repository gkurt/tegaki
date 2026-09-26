import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { type TegakiBundle, TegakiRenderer } from 'tegaki';
import { type FontName, INK, loadFont, markHeadlineWritten, useFont, useHeadlineWritten, useInView, useTheme } from './shared.ts';

const HEADLINE = 'Every font,\nwritten by hand.';

interface Greeting {
  word: string;
  language: string;
  lang: string;
  font: FontName;
  /** Relative size — some faces run small or wide. */
  scale?: number;
  dir?: 'rtl';
  /** Clip to the letterform — for a heavy display face whose round caps bulge past it. */
  clip?: number;
}

const GREETINGS: Greeting[] = [
  { word: 'Hello!', language: 'English', lang: 'en', font: 'Caveat', scale: 1.1 },
  { word: 'こんにちは', language: 'Japanese', lang: 'ja', font: 'Klee One', scale: 0.6 },
  { word: 'مرحبا', language: 'Arabic', lang: 'ar', font: 'Amiri', dir: 'rtl' },
  { word: 'नमस्ते', language: 'Hindi', lang: 'hi', font: 'Tillana', scale: 0.9 },
  { word: 'שלום', language: 'Hebrew', lang: 'he', font: 'Suez One', scale: 0.85, dir: 'rtl', clip: 1.6 },
  { word: '반가워요', language: 'Korean', lang: 'ko', font: 'Nanum Pen Script', scale: 0.95 },
];

/** Seconds each greeting takes to write, then the pause before the row writes again. */
const WRITE = 2.4;
const LOOP_GAP = 2.6;

/**
 * The row's shared loop, as write progress (0–1, held at 1 through the gap). Its
 * clock runs only while `playing`, so pausing the row off screen keeps every
 * tile in step.
 */
function useLoopProgress(playing: boolean): number {
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      elapsed.current += Math.max(0, now - last) / 1000;
      last = now;
      setProgress(Math.min(1, (elapsed.current % (WRITE + LOOP_GAP)) / WRITE));
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return progress;
}

function GreetingTile({ greeting, font, progress }: { greeting: Greeting; font: TegakiBundle | undefined; progress: number }) {
  return (
    <figure className="greeting" style={{ '--scale': greeting.scale ?? 1 } as CSSProperties}>
      <div className="greeting-ink" lang={greeting.lang}>
        {font ? (
          <TegakiRenderer
            font={font}
            direction={greeting.dir}
            time={{ mode: 'controlled', value: progress, unit: 'progress' }}
            quality={greeting.clip ? { clipText: greeting.clip } : undefined}
          >
            {greeting.word}
          </TegakiRenderer>
        ) : (
          <span className="greeting-spinner" aria-hidden="true" />
        )}
      </div>
      <figcaption>
        <span>{greeting.language}</span>
        <span>{greeting.font}</span>
      </figcaption>
    </figure>
  );
}

/**
 * A row of greetings, looping in step. Each tile appears as soon as its font is
 * in and joins the row's loop where it is, so a slow CJK bundle picks up
 * mid-stroke instead of starting a round of its own. The loop starts with the
 * first font. Fetching starts once the headline's own font is in, so they
 * don't compete with it.
 */
export function Greetings() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  const [fonts, setFonts] = useState<Partial<Record<FontName, TegakiBundle>>>({});
  const progress = useLoopProgress(visible && Object.keys(fonts).length > 0);

  useEffect(() => {
    let cancelled = false;
    loadFont('Parisienne').then(() => {
      for (const g of GREETINGS) {
        loadFont(g.font).then((bundle) => {
          if (!cancelled) setFonts((prev) => ({ ...prev, [g.font]: bundle }));
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={ref} className="greetings">
      {GREETINGS.map((g) => (
        <GreetingTile key={g.lang} greeting={g} font={fonts[g.font]} progress={progress} />
      ))}
    </div>
  );
}

/**
 * The headline writes itself, then a giant 書 ("to write") is drawn behind it.
 * It waits for the headline, which also gives Klee One (8 MB) time to arrive.
 */
export function Hero() {
  const font = useFont('Parisienne');
  const written = useHeadlineWritten();
  const [run, setRun] = useState(0);
  const kanjiFont = useFont(written ? 'Klee One' : null);
  const palette = INK[useTheme()];

  const headlineEffects = useMemo(
    () => ({ globalGradient: { colors: [palette.ink, palette.ink, palette.ink, palette.seal], angle: 12 } }),
    [palette],
  );

  return (
    <div className="hero-writing">
      <div className="hero-kanji" aria-hidden="true">
        {kanjiFont && (
          <TegakiRenderer key={`k${run}`} font={kanjiFont} time={{ mode: 'uncontrolled', duration: 4.5 }} quality={{ smoothing: true }}>
            書
          </TegakiRenderer>
        )}
      </div>
      {/* Keyed so the headline is replaced, not resized, when the font arrives: its
          width follows the text, and a resized box would shift the page. */}
      <div key={font ? 'ink' : 'placeholder'} className="hero-headline">
        <div className="hero-headline-ink" aria-hidden="true">
          {font ? (
            <TegakiRenderer
              key={`h${run}`}
              font={font}
              time={{ mode: 'uncontrolled', duration: 4.6, delay: 0.3 }}
              timing={{ glyphGap: 0.02, wordGap: 0.12, lineGap: 0.25 }}
              effects={headlineEffects}
              quality={{ smoothing: true, pixelRatio: 1.5 }}
              onComplete={markHeadlineWritten}
            >
              {HEADLINE}
            </TegakiRenderer>
          ) : (
            <div className="hero-headline-placeholder">{HEADLINE}</div>
          )}
        </div>
        <button
          type="button"
          className="replay"
          onClick={() => setRun((r) => r + 1)}
          disabled={!font}
          aria-label="Write the headline again"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Replay
        </button>
      </div>
    </div>
  );
}
