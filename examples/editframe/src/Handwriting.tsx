import { type CSSProperties, useEffect, useRef } from 'react';
import { type TegakiBundle, TegakiEngine, type TegakiEngineOptions } from 'tegaki/react';

export interface InkProps {
  font: TegakiBundle;
  text: string;
  /**
   * Receives the live `TegakiEngine` (and `null` on unmount). The owning scene
   * registers an editframe `addFrameTask` and, every rendered frame, pushes the
   * word's writing progress into this engine via `update({ time })` — which
   * redraws the canvas synchronously, so editframe's export capture sees the
   * correct frame. (A React-state clock only settles on a later async re-render
   * that the export capture never waits for, which leaves exports blank.)
   */
  onEngine?: (engine: TegakiEngine | null) => void;
  className?: string;
  style?: CSSProperties;
  effects?: Record<string, unknown>;
  direction?: 'ltr' | 'rtl';
  quality?: Record<string, unknown>;
}

/**
 * A single handwritten word. We drive a `TegakiEngine` directly rather than the
 * `TegakiRenderer` component so the scene owns the clock: the engine is created
 * once in `controlled` mode pinned at progress 0 (Tegaki never starts its own
 * rAF loop), and the per-frame `addFrameTask` pushes the real progress in. That
 * keeps time-driving out of React's render cycle, which is what makes it
 * deterministic under editframe's frame-by-frame export. See `onEngine`.
 */
export const Ink = ({ font, text, onEngine, className, style, effects, direction, quality }: InkProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TegakiEngine | null>(null);
  const onEngineRef = useRef(onEngine);
  onEngineRef.current = onEngine;

  // Create the engine exactly once, after mount so the container's font-size and
  // color are applied and the engine measures correctly. Deps are intentionally
  // empty: the effect below reflects later prop changes without re-creating it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: create-once on mount by design; prop changes handled by the effect below.
  useEffect(() => {
    const options: TegakiEngineOptions = {
      text,
      font,
      effects: effects as TegakiEngineOptions['effects'],
      direction,
      quality: quality as TegakiEngineOptions['quality'],
      time: { mode: 'controlled', value: 0, unit: 'progress' },
    };
    const engine = new TegakiEngine(containerRef.current!, options);
    engineRef.current = engine;
    onEngineRef.current?.(engine);
    return () => {
      onEngineRef.current?.(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Reflect prop changes (text / font / effects / …) into the engine. Time is
  // owned by the scene's frame task, so it is intentionally not set here.
  useEffect(() => {
    engineRef.current?.update({
      text,
      font,
      effects: effects as TegakiEngineOptions['effects'],
      direction,
      quality: quality as TegakiEngineOptions['quality'],
    });
  }, [text, font, effects, direction, quality]);

  return <div ref={containerRef} className={className} style={style} />;
};
