import type opentype from 'opentype.js';

export interface VariantGlyph {
  /** OpenType glyph id of the variant. */
  gid: number;
  /** First cluster char observed producing this variant — used for RTL detection. */
  clusterChar: string;
}

/**
 * Discover every glyph id reachable from `chars` by walking the font's GSUB
 * substitution graph to a fixed point. Seeds with each input char's cmap'd
 * gid, then propagates ancestry through GSUB lookup types 1 (single), 2
 * (multiple), 3 (alternate), and 4 (ligature) — the four substitution types
 * that actually emit new gids. Types 5/6/8 (contextual / chaining) only
 * constrain when other lookups fire and are referenced by index from the same
 * lookup list we walk, so ignoring their context constraints produces a
 * superset of shaper-reachable gids: every gid HB could ever emit for any
 * combination of the input chars, plus a few that contextual rules would
 * gate off in practice. Type 7 (extension) is unwrapped to its inner type.
 *
 * Replaces the previous bigram/trigram sweep, which missed contextual forms
 * that only emerge in 4+ char contexts (e.g. Amiri's medial-ت 657, which
 * `liga` collapses into a 3-letter ligature for "كتا" alone but reappears
 * as a standalone medial when preceded by a joiner — "بكتا").
 *
 * The first cluster char observed producing each variant is returned so
 * downstream code can infer script direction (RTL for Arabic/Hebrew clusters)
 * when processing variants that lack their own unicode mapping.
 */
export function enumerateVariantGlyphIds(font: opentype.Font, chars: readonly string[]): Map<number, VariantGlyph> {
  const ancestor = new Map<number, string>();
  for (const ch of chars) {
    const gid = font.charToGlyphIndex(ch);
    if (gid === 0) continue;
    if (!ancestor.has(gid)) ancestor.set(gid, ch);
  }

  const gsub = (font.tables as { gsub?: GsubTable }).gsub;
  if (gsub?.lookups) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const lookup of gsub.lookups) {
        for (const subtable of lookup.subtables ?? []) {
          if (walkSubtable(lookup.lookupType, subtable, ancestor)) changed = true;
        }
      }
    }
  }

  const variants = new Map<number, VariantGlyph>();
  for (const [gid, clusterChar] of ancestor) {
    if (gid === 0) continue;
    variants.set(gid, { gid, clusterChar });
  }
  return variants;
}

// ── GSUB walker ─────────────────────────────────────────────────────────────

interface Coverage {
  format: 1 | 2;
  glyphs?: number[];
  ranges?: { start: number; end: number; index: number }[];
}

interface GsubLookup {
  lookupType: number;
  subtables?: GsubSubtable[];
}

// Minimal shape of the GSUB subtable variants we walk. Fields not relevant to
// ancestry propagation are typed loosely.
interface GsubSubtable {
  substFormat?: number;
  coverage?: Coverage;
  // Type 1 single sub
  deltaGlyphId?: number;
  substitute?: number[];
  // Type 2 multiple sub
  sequences?: number[][];
  // Type 3 alternate sub
  alternateSets?: number[][];
  // Type 4 ligature sub
  ligatureSets?: { ligGlyph: number; components: number[] }[][];
  // Type 7 extension
  extensionLookupType?: number;
  extension?: GsubSubtable;
}

interface GsubTable {
  lookups?: GsubLookup[];
}

/**
 * For input gid `gid`, return its index inside the coverage table, or -1 if
 * the gid isn't covered. The index is what the substitution arrays
 * (`substitute`, `sequences`, `alternateSets`, `ligatureSets`) are indexed by.
 */
function coverageIndex(coverage: Coverage | undefined, gid: number): number {
  if (!coverage) return -1;
  if (coverage.format === 1 && coverage.glyphs) {
    return coverage.glyphs.indexOf(gid);
  }
  if (coverage.format === 2 && coverage.ranges) {
    for (const r of coverage.ranges) {
      if (gid >= r.start && gid <= r.end) return r.index + (gid - r.start);
    }
  }
  return -1;
}

function setAncestor(ancestor: Map<number, string>, gid: number, ch: string): boolean {
  if (gid === 0 || ancestor.has(gid)) return false;
  ancestor.set(gid, ch);
  return true;
}

/** Returns true if any ancestor mapping changed. */
function walkSubtable(lookupType: number, st: GsubSubtable, ancestor: Map<number, string>): boolean {
  // Type 7: extension wraps another subtable type.
  if (lookupType === 7 && st.extension && st.extensionLookupType !== undefined) {
    return walkSubtable(st.extensionLookupType, st.extension, ancestor);
  }

  switch (lookupType) {
    case 1:
      return walkSingleSub(st, ancestor);
    case 2:
      return walkMultipleSub(st, ancestor);
    case 3:
      return walkAlternateSub(st, ancestor);
    case 4:
      return walkLigatureSub(st, ancestor);
    default:
      // Types 5/6/8 are contextual — they don't substitute directly, they
      // trigger lookups by index from the same list we're already walking.
      return false;
  }
}

/** Type 1 — Single substitution. One input gid → one output gid. */
function walkSingleSub(st: GsubSubtable, ancestor: Map<number, string>): boolean {
  let changed = false;
  const cov = st.coverage;
  if (!cov) return false;
  const gids = expandCoverage(cov);
  for (const inGid of gids) {
    const cp = ancestor.get(inGid);
    if (cp === undefined) continue;
    let outGid: number | undefined;
    if (st.substFormat === 1 && st.deltaGlyphId !== undefined) {
      outGid = (inGid + st.deltaGlyphId) & 0xffff;
    } else if (st.substFormat === 2 && st.substitute) {
      const idx = coverageIndex(cov, inGid);
      outGid = st.substitute[idx];
    }
    if (outGid !== undefined && setAncestor(ancestor, outGid, cp)) changed = true;
  }
  return changed;
}

/** Type 2 — Multiple substitution. One input gid → sequence of output gids. */
function walkMultipleSub(st: GsubSubtable, ancestor: Map<number, string>): boolean {
  let changed = false;
  const cov = st.coverage;
  if (!cov || !st.sequences) return false;
  for (const inGid of expandCoverage(cov)) {
    const cp = ancestor.get(inGid);
    if (cp === undefined) continue;
    const idx = coverageIndex(cov, inGid);
    const seq = st.sequences[idx];
    if (!seq) continue;
    for (const outGid of seq) {
      if (setAncestor(ancestor, outGid, cp)) changed = true;
    }
  }
  return changed;
}

/** Type 3 — Alternate substitution. One input gid → choice of output gids. */
function walkAlternateSub(st: GsubSubtable, ancestor: Map<number, string>): boolean {
  let changed = false;
  const cov = st.coverage;
  if (!cov || !st.alternateSets) return false;
  for (const inGid of expandCoverage(cov)) {
    const cp = ancestor.get(inGid);
    if (cp === undefined) continue;
    const idx = coverageIndex(cov, inGid);
    const alts = st.alternateSets[idx];
    if (!alts) continue;
    for (const outGid of alts) {
      if (setAncestor(ancestor, outGid, cp)) changed = true;
    }
  }
  return changed;
}

/**
 * Type 4 — Ligature substitution. Multiple input gids → one output ligature
 * gid. The first component is in coverage; the remaining components live in
 * the `components` array on each ligature record. Propagates ancestry from
 * the first component (any input would be a defensible choice; first matches
 * how shapers identify the cluster).
 */
function walkLigatureSub(st: GsubSubtable, ancestor: Map<number, string>): boolean {
  let changed = false;
  const cov = st.coverage;
  if (!cov || !st.ligatureSets) return false;
  for (const firstGid of expandCoverage(cov)) {
    const idx = coverageIndex(cov, firstGid);
    const set = st.ligatureSets[idx];
    if (!set) continue;
    for (const lig of set) {
      // Skip the ligature unless every component (including the first, in
      // coverage) has a known ancestor — otherwise we'd attribute a ligature
      // to a cp whose codepoint never appears in any of the inputs.
      const firstCp = ancestor.get(firstGid);
      if (firstCp === undefined) continue;
      let allKnown = true;
      for (const comp of lig.components) {
        if (!ancestor.has(comp)) {
          allKnown = false;
          break;
        }
      }
      if (!allKnown) continue;
      if (setAncestor(ancestor, lig.ligGlyph, firstCp)) changed = true;
    }
  }
  return changed;
}

function expandCoverage(coverage: Coverage): number[] {
  const out: number[] = [];
  if (coverage.format === 1 && coverage.glyphs) {
    out.push(...coverage.glyphs);
  } else if (coverage.format === 2 && coverage.ranges) {
    for (const r of coverage.ranges) {
      for (let g = r.start; g <= r.end; g++) out.push(g);
    }
  }
  return out;
}
