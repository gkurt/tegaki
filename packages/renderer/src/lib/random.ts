/**
 * A random number generator (0–1) that yields the same sequence for the same
 * `seed` and `key` — so something painted every frame with it (bristles,
 * speckles) stays put instead of flickering. mulberry32 over an FNV-1a hash.
 */
export function seededRandom(seed: number, key: string | number): () => number {
  let h = 2166136261 ^ Math.floor(seed * 1000);
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
