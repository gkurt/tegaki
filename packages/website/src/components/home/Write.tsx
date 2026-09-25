import { useMemo, useRef } from 'react';
import { TegakiRenderer } from 'tegaki';
import { type FontName, useFont, useInView } from './shared.ts';

const QUALITY = { smoothing: true };

interface WriteProps {
  text: string;
  font?: FontName;
  className?: string;
  /** Ink from the page palette. Default `ink`. */
  tone?: 'ink' | 'seal' | 'muted';
  speed?: number;
  delay?: number;
  /** Loop the writing (paused while off screen); otherwise it writes once, the first time it's seen. */
  loop?: boolean;
}

/** A line of handwriting that writes itself when it scrolls into view. */
export function Write({ text, font: fontName = 'Caveat', className, tone = 'ink', speed = 1, delay = 0.2, loop = false }: WriteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, threshold: 0.4 });
  const visible = useInView(ref);
  const font = useFont(seen ? fontName : null);
  const time = useMemo(
    () => ({ mode: 'uncontrolled' as const, speed, delay, loop, loopGap: 2.5, playing: loop ? visible : true }),
    [speed, delay, loop, visible],
  );

  return (
    <div ref={ref} className={className} style={{ color: `var(--${tone})` }}>
      {font ? (
        <TegakiRenderer font={font} time={time} quality={QUALITY}>
          {text}
        </TegakiRenderer>
      ) : (
        <span className="write-placeholder">{text}</span>
      )}
    </div>
  );
}
