/** The highest seed the studio's slider reaches — enough versions to scrub through, few enough to find one again. */
export const MAX_SEED = 999;

/** A seed other than `current`, from the slider's range. */
export function rollSeed(current: number, random: () => number = Math.random): number {
  const next = Math.floor(random() * MAX_SEED);
  return next >= current ? next + 1 : next;
}
