import type React from 'react';
import { type TegakiBundle, TegakiRenderer } from 'tegaki/react';

export interface InkProps {
  font: TegakiBundle;
  text: string;
  /**
   * Writing progress as a 0–1 ratio of the word's own stroke timeline.
   * `0` = nothing drawn, `1` = fully written. The scene owns the clock and maps
   * its progress onto this, so a word always finishes writing exactly when the
   * scene wants it to — no per-word duration guessing, and frame-deterministic.
   */
  progress: number;
  className?: string;
  style?: React.CSSProperties;
  effects?: Record<string, unknown>;
  direction?: 'ltr' | 'rtl';
  quality?: Record<string, unknown>;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A single handwritten word, drawn stroke-by-stroke by Tegaki, positioned by a
 * 0–1 progress value (Tegaki's `unit: "progress"` controlled mode).
 */
export const Ink = ({ font, text, progress, className, style, effects, direction, quality }: InkProps) => {
  return (
    <TegakiRenderer
      font={font}
      text={text}
      time={{ mode: 'controlled', value: clamp01(progress), unit: 'progress' }}
      effects={effects as never}
      direction={direction}
      quality={quality as never}
      className={className}
      style={style}
    />
  );
};
