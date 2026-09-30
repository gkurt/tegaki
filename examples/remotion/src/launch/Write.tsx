import { type CSSProperties, useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { TegakiRenderer } from 'tegaki';
import { computeTimeline, type TegakiPluginSpec, type TegakiQuality } from 'tegaki/core';
import type { Bundle } from './fonts.ts';

export interface WriteProps {
  font: Bundle;
  text: string;
  /** Frame (of the enclosing sequence) the pen starts at. */
  from?: number;
  /**
   * Frames to write the whole text in: the pace is scaled to fit, and time runs on
   * past the end (for what plugins do after the pen). Unset: the bundle's own pace times `speed`.
   */
  frames?: number;
  /** Playback rate when `frames` is unset. */
  speed?: number;
  /** Override the time: timeline seconds, or progress 0–1 with `unit: 'progress'`. */
  time?: number;
  unit?: 'seconds' | 'progress';
  size: number;
  color?: string;
  plugins?: readonly TegakiPluginSpec[];
  quality?: TegakiQuality;
  pressure?: number;
  seed?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Tegaki in a Remotion frame: controlled time, taken from the frame, so every
 * frame renders the same whichever tab or process draws it.
 */
export const Write: React.FC<WriteProps> = ({
  font,
  text,
  from = 0,
  frames,
  speed = 1,
  time,
  unit,
  size,
  color,
  plugins,
  quality,
  pressure,
  seed,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = Math.max(0, frame - from);
  // The timeline's length before shaping — close enough to pace by.
  const length = useMemo(() => computeTimeline(text, font).totalDuration, [text, font]);
  const t =
    time !== undefined
      ? { mode: 'controlled' as const, value: time, unit: unit ?? 'seconds' }
      : frames !== undefined
        ? { mode: 'controlled' as const, value: (local / frames) * length }
        : { mode: 'controlled' as const, value: (local / fps) * speed };
  return (
    <TegakiRenderer
      font={font}
      text={text}
      time={t}
      plugins={plugins}
      quality={quality}
      pressure={pressure}
      seed={seed}
      style={{ fontSize: size, color, lineHeight: 1.1, whiteSpace: 'pre', ...style }}
    />
  );
};
