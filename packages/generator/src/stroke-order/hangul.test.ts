import { describe, expect, test } from 'bun:test';
import { createHangulProvider, decomposeHangul, hangulLetters, hangulStrokes } from './hangul.ts';

describe('decomposeHangul', () => {
  test('한 is ㅎ + ㅏ + ㄴ', () => {
    expect(decomposeHangul('한')).toEqual(['ㅎ', 'ㅏ', 'ㄴ']);
  });

  test('a syllable without a final has an empty final', () => {
    expect(decomposeHangul('가')).toEqual(['ㄱ', 'ㅏ', '']);
  });

  test('the first and last syllables of the block decompose', () => {
    expect(decomposeHangul('가')).toEqual(['ㄱ', 'ㅏ', '']);
    expect(decomposeHangul('힣')).toEqual(['ㅎ', 'ㅣ', 'ㅎ']);
  });

  test('anything outside the syllable block is null (Latin, compatibility jamo)', () => {
    expect(decomposeHangul('A')).toBeNull();
    expect(decomposeHangul('ㅎ')).toBeNull();
  });
});

describe('hangulLetters', () => {
  test('a syllable is initial, vowel, final in pen order (한: ㅎ 3 strokes, ㅏ 2, ㄴ 1)', () => {
    expect(hangulLetters('한')!.map((letter) => letter.length)).toEqual([3, 2, 1]);
  });

  test('a compound vowel is two letters, the part under the initial first (와: ㅇ, ㅗ, ㅏ)', () => {
    const letters = hangulLetters('와')!;
    expect(letters.length).toBe(3);
    const [, under, beside] = letters;
    const maxY = (strokes: [number, number][][]) => Math.max(...strokes.flat().map(([, y]) => y));
    const minX = (strokes: [number, number][][]) => Math.min(...strokes.flat().map(([x]) => x));
    expect(maxY(under!)).toBeGreaterThan(0.5);
    expect(minX(beside!)).toBeGreaterThanOrEqual(0.7);
  });

  test('a final cluster is two letters side by side (값: ㄱ, ㅏ, ㅂ, ㅅ)', () => {
    const letters = hangulLetters('값')!;
    expect(letters.length).toBe(4);
    const centerX = (strokes: [number, number][][]) => {
      const xs = strokes.flat().map(([x]) => x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    expect(centerX(letters[2]!)).toBeLessThan(centerX(letters[3]!));
  });

  test('a final sits below the initial and vowel', () => {
    const [initial, vowel, final] = hangulLetters('한')!;
    const minY = (strokes: [number, number][][]) => Math.min(...strokes.flat().map(([, y]) => y));
    const maxY = (strokes: [number, number][][]) => Math.max(...strokes.flat().map(([, y]) => y));
    expect(minY(final!)).toBeGreaterThan(maxY(initial!));
    expect(minY(final!)).toBeGreaterThan(maxY(vowel!));
  });

  test('compatibility jamo compose on their own (ㅎ, ㅏ, ㅘ, ㄳ)', () => {
    expect(hangulLetters('ㅎ')!.flat().length).toBe(3);
    expect(hangulLetters('ㅏ')!.flat().length).toBe(2);
    expect(hangulLetters('ㅘ')!.length).toBe(2);
    expect(hangulLetters('ㄳ')!.length).toBe(2);
  });

  test('non-Hangul is null', () => {
    expect(hangulLetters('A')).toBeNull();
    expect(hangulStrokes('あ')).toBeNull();
  });

  test('every syllable composes inside the unit box', () => {
    for (let cp = 0xac00; cp <= 0xd7a3; cp++) {
      const strokes = hangulStrokes(String.fromCodePoint(cp))!;
      expect(strokes.length).toBeGreaterThan(0);
      for (const [x, y] of strokes.flat()) {
        if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`${String.fromCodePoint(cp)} leaves the unit box at ${x},${y}`);
      }
    }
  });
});

describe('createHangulProvider', () => {
  test('strokes carry their letter as group, in pen order', async () => {
    const ref = await createHangulProvider().get('한');
    expect(ref).not.toBeNull();
    expect(ref!.source).toBe('hangul');
    expect(ref!.strokes.map((s) => s.group)).toEqual([0, 0, 0, 1, 1, 2]);
  });

  test('ㅎ draws its tick, then its bar, then its ring, top to bottom', async () => {
    const ref = await createHangulProvider().get('한');
    const [tick, bar, circle] = ref!.strokes.slice(0, 3).map((s) => s.points.map((p) => p.y));
    expect(Math.max(...tick!)).toBeLessThanOrEqual(Math.min(...bar!));
    expect(Math.max(...bar!)).toBeLessThanOrEqual(Math.min(...circle!));
  });

  test('non-Hangul has no entry', async () => {
    expect(await createHangulProvider().get('A')).toBeNull();
  });
});
