/**
 * A tile of paper texture, `n` × `n` cells, as alpha (0–255) per cell: fine
 * speckle — mostly faint, a few strong — and, with `fibers` (0–1), short
 * streaks of pulp at random angles. It wraps at its edges, so it repeats
 * without seams. `amount` (0–1) scales it all; `random` gives 0–1.
 */
export function grainTile(n: number, amount: number, fibers: number, random: () => number): Uint8ClampedArray {
  const cells = new Float32Array(n * n);
  for (let i = 0; i < cells.length; i++) cells[i] = random() ** 3;
  const streaks = Math.round(((n * n) / 90) * fibers);
  for (let f = 0; f < streaks; f++) {
    let x = random() * n;
    let y = random() * n;
    // Mostly along one grain, as paper's fibers lie.
    const angle = (random() - 0.5) * 1.2;
    const length = 3 + random() * 9;
    const strength = 0.35 + random() * 0.4;
    for (let s = 0; s < length; s++) {
      const i = (((Math.floor(y) % n) + n) % n) * n + (((Math.floor(x) % n) + n) % n);
      cells[i] = Math.min(1, cells[i]! + strength);
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
  }
  const out = new Uint8ClampedArray(n * n);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(255 * amount * cells[i]!);
  return out;
}

/** The tile drawn as a canvas, each cell `k` device px square (black, with the tile's alpha) — for `createPattern`. */
export function grainCanvas(tile: Uint8ClampedArray, n: number, k: number): HTMLCanvasElement {
  const size = Math.max(1, Math.round(n * k));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const image = c.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const row = Math.min(n - 1, Math.floor(y / k)) * n;
    for (let x = 0; x < size; x++) image.data[(y * size + x) * 4 + 3] = tile[row + Math.min(n - 1, Math.floor(x / k))]!;
  }
  c.putImageData(image, 0, 0);
  return canvas;
}
