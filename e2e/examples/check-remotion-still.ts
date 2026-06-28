/**
 * Renders a single still frame from the Remotion example through real headless
 * Chromium and asserts the frame actually contains drawn handwriting (a
 * meaningful fraction of non-background pixels), not a blank canvas.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
// Defaults to the workspace remotion example; the post-release check points this
// at a copy with the published npm package installed via TEGAKI_EXAMPLES_DIR.
const examplesDir = process.env.TEGAKI_EXAMPLES_DIR ? resolve(process.env.TEGAKI_EXAMPLES_DIR) : resolve(here, '../../examples');
const remotionDir = resolve(examplesDir, 'remotion');
const outPath = resolve(remotionDir, 'out/still.png');

mkdirSync(dirname(outPath), { recursive: true });

console.log('Rendering Remotion still (Handwriting @ frame 120)...');
execFileSync('bun', ['run', 'still'], { cwd: remotionDir, stdio: 'inherit' });

if (!existsSync(outPath)) {
  console.error(`✗ Remotion produced no still at ${outPath}`);
  process.exit(1);
}

const png = PNG.sync.read(readFileSync(outPath));
let inked = 0;
for (let i = 0; i < png.data.length; i += 4) {
  const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
  // Background is white; count clearly non-white, visible pixels as "ink".
  if (a > 16 && (r < 240 || g < 240 || b < 240)) inked++;
}
const ratio = inked / (png.width * png.height);
console.log(`Still ${png.width}×${png.height}, ink ratio ${(ratio * 100).toFixed(3)}%`);

const MIN_RATIO = 0.001; // 0.1% — text on a 1080p frame is comfortably above this
if (ratio < MIN_RATIO) {
  console.error(`✗ Remotion still looks blank (ink ratio ${(ratio * 100).toFixed(3)}% < ${MIN_RATIO * 100}%)`);
  process.exit(1);
}
console.log('✓ Remotion still rendered handwriting');
