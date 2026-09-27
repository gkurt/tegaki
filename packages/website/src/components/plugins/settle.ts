import type { TegakiPlugin } from 'tegaki/core';

/**
 * A `timing` hook that runs the timeline on until `seconds` after the last
 * stroke ends, for what goes on after the pen has passed (ink drying, a line
 * cooling, dust falling) to finish before the timeline does. It makes the
 * timeline at least that long rather than adding to it, so two such plugins
 * together wait for the longer of the two, not both.
 */
export function settle(seconds: number): TegakiPlugin['timing'] {
  if (seconds <= 0) return undefined;
  return ({ strokes, duration }) => {
    const end = strokes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    return { strokes, duration: Math.max(duration, end + seconds) };
  };
}
