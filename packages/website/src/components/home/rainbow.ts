import { createPlugin } from 'tegaki/core';

/** Every letter a color of its own, round the color wheel. */
export const rainbow = createPlugin({
  name: 'rainbow',
  params: {
    step: { type: 'number', default: 30 },
  },
  setup: ({ step }) => ({
    paint(s, next) {
      const hue = s.stroke.entryIndex * step;
      next({ ...s, style: `hsl(${hue} 80% 50%)` });
    },
  }),
});
