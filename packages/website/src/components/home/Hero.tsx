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

function GreetingTile({ greeting, font }: { greeting: Greeting; font: TegakiBundle | undefined }) {
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref);

  return (
    <figure ref={ref} className="greeting" style={{ '--scale': greeting.scale ?? 1 } as CSSProperties}>
      <div className="greeting-ink" lang={greeting.lang}>
        {font && (
          <TegakiRenderer
            font={font}
            direction={greeting.dir}
            time={{ mode: 'uncontrolled', duration: 2.4, loop: true, loopGap: 2.6, playing: visible }}
            quality={greeting.clip ? { clipText: greeting.clip } : undefined}
          >
            {greeting.word}
          </TegakiRenderer>
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
 * A row of greetings, looping in step. Every tile waits for all six fonts — the
 * CJK bundles are the slow ones — so the row writes its first round together
 * rather than the CJK tiles joining a loop late. Fetching starts once the
 * headline's own font is in, so they don't compete with it.
 */
export function Greetings() {
  const [fonts, setFonts] = useState<Partial<Record<FontName, TegakiBundle>>>({});

  useEffect(() => {
    let cancelled = false;
    loadFont('Parisienne')
      .then(() => Promise.all(GREETINGS.map((g) => loadFont(g.font).then((bundle) => [g.font, bundle] as const))))
      .then((entries) => {
        if (!cancelled) setFonts(Object.fromEntries(entries));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="greetings">
      {GREETINGS.map((g) => (
        <GreetingTile key={g.lang} greeting={g} font={fonts[g.font]} />
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
      <div className="hero-headline" aria-hidden="true">
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
      <button type="button" className="replay" onClick={() => setRun((r) => r + 1)} disabled={!font} aria-label="Write the headline again">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Replay
      </button>
    </div>
  );
}
