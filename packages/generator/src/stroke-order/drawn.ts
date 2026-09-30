// Hand-drawn stroke-order datasets: references a person draws over a glyph in
// the Studio's Reference stage, downloaded as a JSON file and read back by the
// Studio (Upload) or the CLI (`--reference-file`). Switched on, a drawn
// dataset comes before the built-in ones for the characters it has (see
// createReferenceSet): a drawing is the order someone asked for. Several
// drawings of a character compete as variants, the best fit to the ink winning.
//
// The file: `{ format, version, name, glyphs }`, each glyph a list of strokes
// in pen order, each stroke `[x, y]` points in pen direction. Coordinates are
// thousandths of an em from the glyph's origin on the baseline, y down —
// registration fits the strokes onto the ink's box anyway, so a drawing made
// over one font orders another.

import * as z from 'zod/v4';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

export const DRAWN_DATASET_FORMAT = 'tegaki-stroke-order';

/** The frame drawn strokes are measured in: an em of 1000 units. */
export const DRAWN_UNITS_PER_EM = 1000;

const pointSchema = z.tuple([z.number(), z.number()]);

export const drawnDatasetSchema = z.object({
  format: z.literal(DRAWN_DATASET_FORMAT),
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  license: z.string().optional(),
  /** Strokes per character, in pen order; each stroke's points in pen direction. */
  glyphs: z.record(z.string(), z.array(z.array(pointSchema).min(1))),
});

export type DrawnDataset = z.infer<typeof drawnDatasetSchema>;

/** A drawn dataset from its JSON, or an error naming what's wrong with it. */
export function parseDrawnDataset(json: string): DrawnDataset {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not a JSON file');
  }
  const parsed = drawnDatasetSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    throw new Error(`Not a tegaki stroke-order dataset${where}: ${issue.message}`);
  }
  return parsed.data;
}

/** An empty dataset to draw into. */
export function createDrawnDataset(name: string): DrawnDataset {
  return { format: DRAWN_DATASET_FORMAT, version: 1, name, glyphs: {} };
}

/** A short hash of a glyph's strokes, so a cache keyed by source can tell one drawing from the next. */
function strokesRevision(strokes: [number, number][][]): string {
  let h = 5381;
  for (const stroke of strokes) {
    h = (h * 33) ^ 124;
    for (const [x, y] of stroke) h = (((h * 33) ^ Math.round(x * 10)) * 33) ^ Math.round(y * 10);
  }
  return (h >>> 0).toString(36);
}

/**
 * A provider over a drawn dataset. `dataset` may be a function, read on every
 * lookup, for a dataset still being drawn: its answer then follows the edits
 * (with a new `revision` each time a glyph's strokes change).
 */
export function createDrawnDatasetProvider(dataset: DrawnDataset | (() => DrawnDataset | null)): StrokeOrderProvider {
  const read = typeof dataset === 'function' ? dataset : () => dataset;
  const initial = read();
  return {
    name: initial?.name ?? 'drawn',
    async get(char: string): Promise<ReferenceGlyph | null> {
      const current = read();
      const strokes = current && Object.hasOwn(current.glyphs, char) ? current.glyphs[char] : undefined;
      if (!current || !strokes || strokes.length === 0) return null;
      return {
        char,
        strokes: strokes.map((points) => ({ points: points.map(([x, y]) => ({ x, y })) })),
        viewBox: { width: DRAWN_UNITS_PER_EM, height: DRAWN_UNITS_PER_EM },
        source: current.name,
        license: current.license ?? `${current.name} — drawn in Tegaki Studio`,
        revision: strokesRevision(strokes),
      };
    },
  };
}
