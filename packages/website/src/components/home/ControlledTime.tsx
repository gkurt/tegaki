import { useEffect, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import type { Timeline } from 'tegaki/core';
import { useFont, useInView } from './shared.ts';

const SCROLL_TEXT = 'Written as you scroll,\nerased as you scroll back.';
const SLIDER_TEXT = 'Drag the slider\nto move the pen.';

/**
 * `time="css"`: the renderer reads `--tegaki-progress`, which a scroll-driven
 * CSS animation (`animation-timeline: view()`, in home.css) moves as the card
 * crosses the viewport. No scroll listener. Browsers without scroll timelines
 * just play it once.
 */
function ScrollLinked() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '400px 0px' });
  const font = useFont(near ? 'Caveat' : null);
  // Only used once the font is in (after hydration), so the server's `false` never reaches the markup.
  const [scrollTimelines] = useState(() => typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()'));

  return (
    <figure ref={ref} className="controlled-card">
      <div className="controlled-ink">
        {font && (
          <TegakiRenderer
            className="scroll-linked"
            font={font}
            time={scrollTimelines ? 'css' : { mode: 'uncontrolled', duration: 3 }}
            quality={{ smoothing: true }}
          >
            {SCROLL_TEXT}
          </TegakiRenderer>
        )}
      </div>
      <figcaption>
        <span>Scroll-linked</span>
        <code>time="css" + animation-timeline: view()</code>
      </figcaption>
    </figure>
  );
}

/** Padded to a fixed width, so the readout's text doesn't move as a number gains a digit. */
const seconds = (s: number) => s.toFixed(2).padStart(5, ' ');

/** `time={seconds}` from a range input. It sweeps once on first view, then it's the reader's. */
function Scrubbed() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '400px 0px' });
  const seen = useInView(ref, { once: true, threshold: 0.6 });
  const font = useFont(near ? 'Parisienne' : null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const touched = useRef(false);

  useEffect(() => {
    if (!seen || !duration || touched.current) return;
    const start = performance.now();
    const sweepMs = 3200;
    let raf = requestAnimationFrame(function step(now) {
      if (touched.current) return;
      const p = Math.min(1, (now - start) / sweepMs);
      setTime(duration * (1 - (1 - p) ** 2));
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [seen, duration]);

  return (
    <figure ref={ref} className="controlled-card">
      <div className="controlled-ink controlled-ink-script">
        {font && (
          <TegakiRenderer
            font={font}
            time={time}
            quality={{ smoothing: true }}
            onChangeTimeline={(t: Timeline) => setDuration(t.totalDuration)}
          >
            {SLIDER_TEXT}
          </TegakiRenderer>
        )}
      </div>
      <div className="scrubber">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          aria-label="Timeline position"
          onPointerDown={() => {
            touched.current = true;
          }}
          onKeyDown={() => {
            touched.current = true;
          }}
          onChange={(e) => setTime(Number(e.target.value))}
          style={{ '--fill': `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
        />
        <code>
          {seconds(time)}s <span className="scrubber-total">/ {seconds(duration)}s</span>
        </code>
      </div>
      <figcaption>
        <span>Scrubbed</span>
        <code>time={'{seconds}'}</code>
      </figcaption>
    </figure>
  );
}

export function ControlledTime() {
  return (
    <div className="controlled">
      <ScrollLinked />
      <Scrubbed />
    </div>
  );
}
