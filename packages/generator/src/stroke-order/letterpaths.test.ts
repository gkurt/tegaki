import { describe, expect, test } from 'bun:test';
import {
  createLetterpathsCursiveHighProvider,
  createLetterpathsCursiveProvider,
  createLetterpathsPrintProvider,
  decodeLetterpaths,
} from './letterpaths.ts';

describe('letterpaths', () => {
  test('decodes strokes joined by | and points by spaces', () => {
    expect(decodeLetterpaths('0,0 10,5|3,4')).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      [{ x: 3, y: 4 }],
    ]);
  });

  test('print a is written in one motion, its bowl before its stem (Hershey Simplex lifts the pen between them)', async () => {
    const a = await createLetterpathsPrintProvider().get('a');
    expect(a!.source).toBe('letterpaths-print');
    expect(a!.strokes.length).toBe(1);
    // It starts at the top right of the bowl, heading left.
    const [p0, p1] = a!.strokes[0]!.points;
    expect(p1!.x).toBeLessThan(p0!.x);
  });

  test('print covers both cases; cursive only lowercase', async () => {
    expect(await createLetterpathsPrintProvider().get('Q')).not.toBeNull();
    expect(await createLetterpathsCursiveProvider().get('Q')).toBeNull();
    expect(await createLetterpathsCursiveHighProvider().get('q')).not.toBeNull();
  });

  test('an i draws its dot after its stem', async () => {
    const i = await createLetterpathsCursiveProvider().get('i');
    const [stem, dot] = i!.strokes;
    expect(dot).toBeDefined();
    const top = (s: typeof stem) => Math.min(...s!.points.map((p) => p.y));
    expect(top(dot)).toBeLessThan(top(stem));
  });

  test('characters outside the set, and object keys, have no entry', async () => {
    const provider = createLetterpathsPrintProvider();
    expect(await provider.get('7')).toBeNull();
    expect(await provider.get('constructor')).toBeNull();
  });
});
