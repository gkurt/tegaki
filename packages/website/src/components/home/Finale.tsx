import { useMemo, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import { INK, useFont, useInView, useTheme } from './shared.ts';

/** "Now, write yours." — and when the pen lifts, the seal comes down. */
export function Finale() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, threshold: 0.5 });
  const font = useFont(seen ? 'Parisienne' : null);
  const [stamped, setStamped] = useState(false);
  const theme = useTheme();
  const palette = INK[theme];
  const effects = useMemo(
    () => ({
      pressureWidth: { strength: 1 },
      taper: { startLength: 0.2, endLength: 0.3 },
      globalGradient: { colors: [palette.ink, palette.ink, palette.seal], angle: 0 },
    }),
    [palette],
  );

  return (
    <div ref={ref} className="finale-writing">
      <div className="finale-line" aria-hidden="true">
        {font ? (
          <TegakiRenderer
            font={font}
            time={{ mode: 'uncontrolled', duration: 4, delay: 0.2 }}
            effects={effects}
            quality={{ smoothing: true, pixelRatio: 1.5 }}
            onComplete={() => setStamped(true)}
          >
            Now, write yours.
          </TegakiRenderer>
        ) : (
          <span className="write-placeholder">Now, write yours.</span>
        )}
      </div>
      <div className={`seal seal-lg${stamped ? ' stamped' : ''}`} aria-hidden="true">
        <span>手</span>
        <span>書</span>
      </div>
    </div>
  );
}
