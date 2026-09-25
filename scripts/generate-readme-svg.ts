/**
 * Generate the README hero (media/hello-world.svg): "Tegaki is awesome" in the
 * shipped Caveat bundle, as the looping SVG the `tegaki` CLI writes (CSS
 * keyframes, not SMIL, so GitHub animates it).
 * Usage: bun scripts/generate-readme-svg.ts
 */
import caveat from '../packages/renderer/fonts/caveat/bundle.ts';
import { textToSvg } from '../packages/renderer/src/lib/textToSvg.ts';
import type { TegakiBundle } from '../packages/renderer/src/types.ts';

const svg = textToSvg('Tegaki is awesome', caveat as unknown as TegakiBundle, {
  mode: 'loop',
  fontSize: 140,
  timing: { stagger: { advance: '80%', duration: 'auto' } },
});

await Bun.write('media/hello-world.svg', svg);
console.log(`Generated media/hello-world.svg (${(svg.length / 1024).toFixed(1)} KB)`);
