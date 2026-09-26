import { Fragment, useMemo, useRef } from 'react';
import { TegakiRenderer } from 'tegaki';
import { INK, useFont, useInView, useTheme } from './shared.ts';

/** "Now, write yours." */
export function Finale() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, threshold: 0.5 });
  const font = useFont(seen ? 'Parisienne' : null);
  const theme = useTheme();
  const palette = INK[theme];
  const effects = useMemo(
    () => ({
      globalGradient: { colors: [palette.ink, palette.ink, palette.seal], angle: 0 },
    }),
    [palette],
  );

  return (
    <div ref={ref} className="finale-writing">
      {/* Keyed so the line is replaced, not moved, when the font arrives. */}
      <Fragment key={font ? 'ink' : 'placeholder'}>
        <div className="finale-line" aria-hidden="true">
          {font ? (
            <TegakiRenderer
              font={font}
              time={{ mode: 'uncontrolled', duration: 4, delay: 0.2 }}
              effects={effects}
              quality={{ smoothing: true, pixelRatio: 1.5 }}
            >
              Now, write yours.
            </TegakiRenderer>
          ) : (
            <span className="write-placeholder">Now, write yours.</span>
          )}
        </div>
      </Fragment>
    </div>
  );
}
