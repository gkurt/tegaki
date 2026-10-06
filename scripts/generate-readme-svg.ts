/**
 * Generate the README hero (media/hello-world.svg): "Written by hand." in the
 * shipped Parisienne bundle, as the looping SVG the `tegaki` CLI writes (CSS
 * keyframes, not SMIL, so GitHub animates it).
 * Usage: bun scripts/generate-readme-svg.ts
 */
import parisienne from '../packages/renderer/fonts/parisienne/bundle.ts';
import { textToSvg } from '../packages/renderer/src/lib/textToSvg.ts';
import type { TegakiBundle } from '../packages/renderer/src/types.ts';

const svg = textToSvg('Written by hand.', parisienne as unknown as TegakiBundle, {
  mode: 'loop',
  // Parisienne's thick and thin strokes are the point of it (loop mode would draw one width).
  pressure: 1,
  fontSize: 140,
  speed: 2.8,
  // Coarser than the default 2px: the file is shown at ~0.6× and stays small.
  segmentSize: 4,
});

await Bun.write('media/hello-world.svg', svg);
console.log(`Generated media/hello-world.svg (${(svg.length / 1024).toFixed(1)} KB)`);
