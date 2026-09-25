/** What the renderer's timeline says about one grapheme (the `TimelineEntry` fields used here). */
export interface ClusterEntry {
  graphemeIndex: number;
  /** The `glyphDataById` key of the glyph drawn — set when the text was shaped. */
  glyphId?: string;
}

/** The glyphs the renderer drew for the shaping cluster holding a grapheme. */
export interface GlyphCluster {
  /** First grapheme of the cluster. */
  start: number;
  /** One past its last grapheme — a ligature spans several. */
  end: number;
  glyphIds: string[];
}

/**
 * The cluster holding grapheme `index`: the timeline has one entry per drawn
 * glyph at the grapheme its cluster starts on, so a ligature's later letters
 * have none and belong to the entry before them. `length` (graphemes in the
 * text) bounds the last cluster. Null when nothing was drawn at or before
 * `index`.
 */
export function clusterAt(entries: readonly ClusterEntry[], index: number, length: number): GlyphCluster | null {
  let start = -1;
  let end = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    if (e.graphemeIndex <= index) start = Math.max(start, e.graphemeIndex);
    else end = Math.min(end, e.graphemeIndex);
  }
  if (start < 0) return null;
  const glyphIds = entries.filter((e) => e.graphemeIndex === start && e.glyphId !== undefined).map((e) => e.glyphId!);
  return { start, end: Math.min(end, Math.max(length, index + 1)), glyphIds };
}

/** Parse a `glyphDataById` key — `"<gid>"` or `"<subset>:<gid>"`. */
export function parseGlyphKey(key: string): { subset: number; gid: number } | null {
  const m = /^(?:(\d+):)?(\d+)$/.exec(key);
  return m ? { subset: Number(m[1] ?? 0), gid: Number(m[2]) } : null;
}
