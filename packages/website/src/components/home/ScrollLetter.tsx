import { useEffect, useMemo, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import type { Timeline } from 'tegaki/core';
import { useFont, useInView, useTheme } from './shared.ts';

const QUALITY = { smoothing: true };

const LETTER =
  'Dear reader,\nthis page has no video,\nno GIF, and no path\nanyone traced by hand.\nJust a font, and a pen\nthat knows the way.';

/**
 * A letter whose pen is bound to the scroll position: the section is several
 * viewports tall with a sticky stage, and how far it has scrolled through is
 * the renderer's controlled time. Scroll back and the ink lifts off again.
 */
export function ScrollLetter() {
  const trackRef = useRef<HTMLDivElement>(null);
  const near = useInView(trackRef, { once: true, rootMargin: '600px 0px' });
  const font = useFont(near ? 'Caveat' : null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const theme = useTheme();

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = track.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      // Leave a little dead zone at both ends: the page is blank for a beat
      // after the stage pins, and the letter holds finished before it unpins.
      const raw = span > 0 ? -rect.top / span : 0;
      setProgress(Math.min(1, Math.max(0, (raw - 0.06) / 0.84)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const effects = useMemo(
    () => ({
      pressureWidth: { strength: 0.8 },
      taper: { startLength: 0.08, endLength: 0.2 },
      glow: theme === 'dark' ? { radius: 10, color: 'rgba(232, 194, 122, 0.35)' } : false,
    }),
    [theme],
  );
  const time = useMemo(() => ({ mode: 'controlled' as const, value: progress, unit: 'progress' as const }), [progress]);

  return (
    <div ref={trackRef} className="scroll-track">
      <div className="scroll-stage">
        <div className="scroll-paper">
          <div className="scroll-letter">
            {font && (
              <TegakiRenderer
                font={font}
                time={time}
                effects={effects}
                quality={QUALITY}
                onChangeTimeline={(t: Timeline) => setDuration(t.totalDuration)}
              >
                {LETTER}
              </TegakiRenderer>
            )}
          </div>
        </div>
        <div className="scroll-meter" aria-hidden="true">
          <div className="scroll-meter-bar">
            <div className="scroll-meter-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <code>
            t = {(progress * duration).toFixed(2)}s <span className="scroll-meter-total">/ {duration.toFixed(2)}s</span>
          </code>
        </div>
      </div>
    </div>
  );
}
