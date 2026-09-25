import { useMemo, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import { INK, useFont, useTheme } from './shared.ts';

const HEADLINE = 'Every font,\nwritten by hand.';

/**
 * The hero: the headline writes itself, then — once it's done — a giant 書
 * ("to write") brushes in behind it. Klee One is an 8 MB bundle, so it only
 * starts loading after the headline has finished drawing.
 */
export function Hero() {
  const font = useFont('Parisienne');
  const [written, setWritten] = useState(false);
  const [run, setRun] = useState(0);
  const kanjiFont = useFont(written ? 'Klee One' : null);
  const theme = useTheme();
  const palette = INK[theme];

  const headlineEffects = useMemo(
    () => ({
      pressureWidth: { strength: 1 },
      taper: { startLength: 0.2, endLength: 0.25 },
      globalGradient: { colors: [palette.ink, palette.ink, palette.ink, palette.seal], angle: 12 },
    }),
    [palette],
  );
  const kanjiEffects = useMemo(() => ({ pressureWidth: { strength: 1 }, taper: { startLength: 0.1, endLength: 0.35 } }), []);

  return (
    <div className="hero-writing">
      <div className="hero-kanji" aria-hidden="true">
        {kanjiFont && (
          <TegakiRenderer
            key={`k${run}`}
            font={kanjiFont}
            time={{ mode: 'uncontrolled', duration: 4.5 }}
            effects={kanjiEffects}
            quality={{ smoothing: true }}
          >
            書
          </TegakiRenderer>
        )}
      </div>
      <div className="hero-headline" aria-hidden="true">
        {font ? (
          <TegakiRenderer
            key={`h${run}`}
            font={font}
            time={{ mode: 'uncontrolled', duration: 5.2, delay: 0.35 }}
            timing={{ glyphGap: 0.02, wordGap: 0.12, lineGap: 0.25 }}
            effects={headlineEffects}
            quality={{ smoothing: true, pixelRatio: 1.5 }}
            onComplete={() => setWritten(true)}
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
        Write it again
      </button>
    </div>
  );
}
