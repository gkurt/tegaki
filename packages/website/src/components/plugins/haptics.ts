import { createPlugin } from 'tegaki/core';
import { penMotion } from './sound.ts';

/**
 * What to buzz for one frame: a tap of `tap` ms when a stroke touches
 * down, else — with `buzz` — a short pulse while ink is being laid, at
 * most every `every` seconds. `null` for nothing. `sinceBuzz` is seconds
 * since the last pulse.
 */
export function hapticFor(
  motion: { distance: number; touches: number } | null,
  o: { tap: number; buzz: boolean },
  sinceBuzz: number,
  every = 0.09,
): number | null {
  if (!motion) return null;
  if (motion.touches > 0 && o.tap > 0) return o.tap;
  if (o.buzz && motion.distance > 0 && sinceBuzz >= every) return 6;
  return null;
}

/**
 * The pen felt through the phone: a tap as each stroke touches down, and
 * a faint buzz while it writes. `onFrame`, with the Vibration API — only
 * where the browser has one (Android Chrome, not iOS) and once the page
 * has been touched. Seeks and repeated frames are silent, as for Sound.
 */
export const hapticsPlugin = createPlugin({
  name: 'haptics',
  label: 'Haptics',
  description:
    'A tap on the phone as each stroke touches down, a buzz while it writes. onFrame — Android only, once you’ve tapped the page.',
  params: {
    tap: { type: 'number', label: 'Tap', description: 'Milliseconds a touch-down buzzes for.', default: 14, min: 0, max: 60, step: 1 },
    buzz: { type: 'boolean', label: 'Buzz while writing', default: false },
  },
  presets: {
    Strong: { tap: 35, buzz: true },
  },
  setup: (o) => {
    let lastBuzz = -Infinity;
    return {
      onFrame(frame, prev) {
        if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
        const ms = hapticFor(penMotion(frame, prev), o, frame.time - lastBuzz);
        if (ms === null) return;
        lastBuzz = frame.time;
        try {
          navigator.vibrate(ms);
        } catch {
          // Blocked until the page is touched; nothing to do.
        }
      },
    };
  },
});
