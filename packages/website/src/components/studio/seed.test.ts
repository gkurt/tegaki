/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { MAX_SEED, rollSeed } from './seed.ts';

describe('rollSeed', () => {
  test('never rolls the seed it has', () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const current = Math.floor(r * MAX_SEED);
      expect(rollSeed(current, () => r)).not.toBe(current);
    }
  });

  test('stays within the slider’s range', () => {
    for (const r of [0, 0.5, 0.9999]) {
      const seed = rollSeed(0, () => r);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(MAX_SEED);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });
});
