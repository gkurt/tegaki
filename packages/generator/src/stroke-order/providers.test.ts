import { describe, expect, test } from 'bun:test';
import { collectReferences } from './providers.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

const provider = (chars: string): StrokeOrderProvider => ({
  name: 'test',
  get: async (char) =>
    chars.includes(char)
      ? ({ char, strokes: [], viewBox: { width: 1, height: 1 }, source: 'test', license: '' } satisfies ReferenceGlyph)
      : null,
});

describe('collectReferences', () => {
  test("an accented letter no dataset has takes its base letter's reference (é → e)", async () => {
    expect((await collectReferences('é', [provider('e')])).map((r) => r.char)).toEqual(['e']);
  });

  test('a character with its own reference keeps it', async () => {
    expect((await collectReferences('é', [provider('eé')])).map((r) => r.char)).toEqual(['é']);
  });

  test('outside Latin, Greek and Cyrillic there is no fallback (が stays without か)', async () => {
    expect(await collectReferences('が', [provider('か')])).toEqual([]);
  });
});
