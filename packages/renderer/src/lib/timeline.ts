import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import type { BundleShaper } from './shaper.ts';
import { graphemes, lookupGlyphData } from './utils.ts';

export interface TimelineConfig {
  /** Pause between glyphs (seconds). Default: `0.1` */
  glyphGap?: number;
  /** Pause after a space character (seconds). Default: `0.15` */
  wordGap?: number;
  /** Pause after a newline / line break (seconds). Default: `0.3` */
  lineGap?: number;
  /** Duration for characters without glyph data (seconds). Default: `0.2` */
  unknownDuration?: number;
  /**
   * Easing function for each stroke's animation progress `(0–1) → (0–1)`.
   * Applied per-stroke to map linear draw progress to eased progress.
   * Default: ease-out exponential (`1 - 2^(-10t)`).
   */
  strokeEasing?: (t: number) => number;
  /**
   * Easing function for each glyph's local time progress `(0–1) → (0–1)`.
   * Applied per-glyph to map linear time within the glyph to eased time.
   * Default: linear (no easing).
   */
  glyphEasing?: (t: number) => number;
  /**
   * When `true` (default), disconnected marks tagged by the generator — i-dots,
   * Arabic nuqṭa, diacritics — are deferred so every body stroke in a word
   * draws before any dot in that word. When `false`, strokes animate in their
   * bundled order with no deferral.
   *
   * Ignored when `stagger` is set — stagger mode treats every stroke uniformly.
   */
  deferDots?: boolean;
  /**
   * Optional staggered scheduling: each glyph starts a fixed advance after the
   * previous glyph started, regardless of whether the previous glyph has
   * finished drawing. Replaces the default "previous-end + glyphGap" cadence.
   *
   * Word and line breaks still pause for `wordGap` / `lineGap`. Dot deferral
   * is bypassed (each stroke draws in its bundled order). See
   * {@link TimelineStaggerConfig} for `advance` and `duration` semantics.
   */
  stagger?: TimelineStaggerConfig;
}

export interface TimelineStaggerConfig {
  /**
   * Delay between the start of consecutive glyphs.
   * - Number: seconds (e.g. `0.3`).
   * - String ending in `%`: percentage of the previous glyph's bundled
   *   `glyph.t` duration (e.g. `"20%"` starts the next glyph after 20% of the
   *   previous one's bundled duration — heavy overlap; `"120%"` leaves a small
   *   trailing gap).
   */
  advance: number | `${number}%`;
  /**
   * Per-glyph draw duration.
   * - `'auto'` (default): each glyph plays for its bundled duration; strokes
   *   keep their bundled `d`/`a` timing.
   * - Number: every glyph is scaled to take exactly this many seconds. All
   *   strokes inside the glyph are time-scaled (`d * scale`, `a * scale` where
   *   `scale = duration / bundledDuration`).
   */
  duration?: number | 'auto';
}

const DEFAULTS = {
  glyphGap: 0.1,
  wordGap: 0.15,
  lineGap: 0.3,
  unknownDuration: 0.2,
  deferDots: true,
};

export interface TimelineEntry {
  /** First grapheme of the cluster this entry represents. Used for fallback glyph lookup. */
  char: string;
  /** Grapheme index of `char` in the full text — matches `layout.charOffsets`. */
  graphemeIndex: number;
  /**
   * Shaped glyph key (when a shaper produced this entry). Bare numeric string
   * for primary-subset glyphs (e.g. `"42"`), or `"<subsetIndex>:<gid>"` for
   * glyphs from an `extraFontUrls` subset — same format used as the key into
   * `bundle.glyphDataById`.
   */
  glyphId?: string;
  offset: number;
  duration: number;
  hasGlyph: boolean;
  /**
   * Sparse per-stroke override of the bundled stroke's `d` (delay) field. When
   * `strokeDelays[i]` is a number, the renderer treats that value as stroke
   * `i`'s delay (relative to `offset`) instead of the delay stored in the
   * glyph. Populated by word-level dot deferral: priority-tagged strokes get
   * shifted to after every body stroke in the word has drawn.
   */
  strokeDelays?: (number | undefined)[];
  /**
   * X offset of this glyph relative to its visual line's left edge, in em.
   * Populated by `applyShaperPositions` from the shaper's pen-walk: this is
   * `pen.x + dx` where `dx` is the GPOS x-offset for the glyph. The engine
   * combines it with `layout.lineLefts[lineIdx]` to get the final draw x.
   *
   * Why per-entry rather than per-grapheme: in clusters with mark glyphs
   * (e.g. Arabic dot below ي), the base and the mark have different `dx` via
   * mark-attachment GPOS. Storing per-entry preserves both. Falls back to
   * `layout.charOffsets[graphemeIndex]` when undefined.
   */
  xOffsetEm?: number;
  /**
   * Y offset of this glyph relative to the line baseline, in em (positive =
   * down, mirroring CSS axis). Populated by `applyShaperPositions` as
   * `-dy / unitsPerEm` (HB's `dy` is y-up, ours is y-down). Encodes Arabic
   * cursive-attachment GPOS — Aref Ruqaa's wavy Ruq'ah baseline lifts each
   * connected letter by ~250 font units — and mark-attachment vertical
   * offsets. The engine adds `yOffsetEm * fontSize` to `glyphY` so the glyph
   * draws at the correct cursive-lifted height.
   */
  yOffsetEm?: number;
  /**
   * Multiplier applied to bundled stroke `d` (delay) and `a` (animation
   * duration) when drawing this glyph. Populated by stagger mode with a static
   * `duration` to scale the glyph's strokes to fit the new slot. Undefined or
   * `1` means use the bundled timing as-is.
   */
  strokeTimeScale?: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  totalDuration: number;
}

export function computeTimeline(text: string, font: TegakiBundle, config?: TimelineConfig, shaper?: BundleShaper | null): Timeline {
  if (shaper && font.glyphDataById) {
    return computeShapedTimeline(text, font, config, shaper);
  }
  return computeGraphemeTimeline(text, font, config);
}

// ---------------------------------------------------------------------------
// Stagger scheduler — alternative cadence where each glyph starts a fixed
// advance after the previous glyph *started*, regardless of when the previous
// glyph finishes. Used by both the grapheme and shaped paths when
// `config.stagger` is set.
// ---------------------------------------------------------------------------

/** Parse a stagger advance value into seconds, given the previous glyph's bundled duration. */
function resolveAdvance(advance: number | `${number}%`, prevBundled: number): number {
  if (typeof advance === 'number') return Math.max(0, advance);
  // String form: trailing '%' marks a percentage of the previous glyph's bundled `t`.
  const m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(advance);
  if (m) {
    const pct = Number(m[1]) / 100;
    return Math.max(0, pct * prevBundled);
  }
  // Fall back to numeric parsing (string number without %): treat as seconds.
  const n = Number(advance);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

class StaggerScheduler {
  readonly entries: TimelineEntry[] = [];
  private offset = 0;
  /** Bundled `glyph.t` (or `unknownDuration`) of the most recent glyph; basis for percent advances. */
  private prevBundled = 0;
  private hasPrev = false;
  /** Accumulated word/line gap pending until the next glyph (or finalize). */
  private pendingGap = 0;

  constructor(
    private readonly wordGap: number,
    private readonly lineGap: number,
    private readonly advance: number | `${number}%`,
    private readonly staticDuration: number | undefined,
  ) {}

  addGlyph(fields: EntryFields, bundledDuration: number): void {
    if (this.hasPrev) {
      this.offset += resolveAdvance(this.advance, this.prevBundled) + this.pendingGap;
      this.pendingGap = 0;
    }
    const duration = this.staticDuration ?? bundledDuration;
    // Avoid div-by-zero: zero-duration glyphs collapse to scale=1 (no scaling
    // matters when the glyph has no strokes anyway).
    const strokeTimeScale = bundledDuration > 0 ? duration / bundledDuration : 1;
    this.entries.push({
      ...fields,
      offset: this.offset,
      duration,
      ...(strokeTimeScale !== 1 ? { strokeTimeScale } : {}),
    });
    this.prevBundled = bundledDuration;
    this.hasPrev = true;
  }

  /** Emit a zero-duration marker (e.g. whitespace) at the current offset without advancing the cursor. */
  addMarker(fields: EntryFields): void {
    this.entries.push({ ...fields, offset: this.offset, duration: 0 });
  }

  separator(sep: Separator): void {
    this.pendingGap += sep === 'line' ? this.lineGap : this.wordGap;
  }

  finalize(): Timeline {
    const last = this.entries[this.entries.length - 1];
    const total = last ? last.offset + last.duration : 0;
    return { entries: this.entries, totalDuration: total };
  }
}

// ---------------------------------------------------------------------------
// Scheduler — shared body/dot layout for both shaped and grapheme paths.
// ---------------------------------------------------------------------------

type EntryFields = Omit<TimelineEntry, 'offset' | 'duration' | 'strokeDelays'>;

interface Pending {
  fields: EntryFields;
  /** Span of the body-stroke phase (or the full `t` when no strokes are dot-tagged). */
  bodyDuration: number;
  /** Span of the dot-stroke phase (`dotMaxEnd − dotMinD`). Zero when no dots. */
  dotDuration: number;
  /** Minimum `d` across dot strokes — used to re-anchor dots against the word's dot phase. */
  dotMinD: number;
  /** Indices of dot-tagged strokes inside `glyph.s`. */
  dotIndices: number[];
  /** Bundled `d` values of the dot strokes at those indices (parallel to `dotIndices`). */
  dotDelays: number[];
}

type Separator = 'word' | 'line';

/** Decompose a glyph into a body phase and an optional dot phase. */
function partitionGlyph(glyph: TegakiGlyphData, fallbackTotal: number, deferDots: boolean) {
  const strokes = glyph.s;
  let bodyDuration = 0;
  let dotMinD = Infinity;
  let dotMaxEnd = 0;
  const dotIndices: number[] = [];
  const dotDelays: number[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i]!;
    const end = s.d + s.a;
    if (deferDots && (s.r ?? 0) < 0) {
      dotIndices.push(i);
      dotDelays.push(s.d);
      if (s.d < dotMinD) dotMinD = s.d;
      if (end > dotMaxEnd) dotMaxEnd = end;
    } else if (end > bodyDuration) {
      bodyDuration = end;
    }
  }
  if (dotIndices.length === 0) {
    return { bodyDuration: glyph.t ?? fallbackTotal, dotDuration: 0, dotMinD: 0, dotIndices, dotDelays };
  }
  // All-dot glyphs (e.g. a standalone nuqṭa that classification flagged) fall
  // back to plain body rendering so we never emit an empty body phase.
  if (bodyDuration === 0) {
    return { bodyDuration: glyph.t ?? fallbackTotal, dotDuration: 0, dotMinD: 0, dotIndices: [], dotDelays: [] };
  }
  return { bodyDuration, dotDuration: dotMaxEnd - dotMinD, dotMinD, dotIndices, dotDelays };
}

class Scheduler {
  readonly entries: TimelineEntry[] = [];
  private readonly group: Pending[] = [];
  private offset = 0;
  /** Gap appended by the last `separate` call; stripped on `finalize` when no further content followed. */
  private lastGap = 0;

  constructor(
    private readonly glyphGap: number,
    private readonly wordGap: number,
    private readonly lineGap: number,
  ) {}

  add(p: Pending): void {
    // A pending group invalidates any trailing gap — its content sits past
    // the gap, so we're no longer at a strippable trailing position.
    this.lastGap = 0;
    this.group.push(p);
  }

  /**
   * Close the current word group and advance by a separator gap. Optionally
   * emits a zero-width marker entry (e.g. a whitespace grapheme / cluster)
   * between the group end and the gap.
   */
  separate(sep: Separator, marker?: { fields: EntryFields; duration: number }): void {
    this.flushGroup();
    if (marker) {
      this.entries.push({ ...marker.fields, offset: this.offset, duration: marker.duration });
      this.offset += marker.duration;
    }
    const gap = sep === 'line' ? this.lineGap : this.wordGap;
    this.offset += gap;
    this.lastGap = gap;
  }

  finalize(): Timeline {
    this.flushGroup();
    // If the last activity was a `separate`, `lastGap` still holds its gap —
    // strip it so the timeline ends exactly at the last pixel drawn. If
    // instead a group was flushed (resetting `lastGap` to 0), nothing is
    // stripped.
    return { entries: this.entries, totalDuration: Math.max(0, this.offset - this.lastGap) };
  }

  private flushGroup(): void {
    if (this.group.length === 0) return;
    const group = this.group;

    // --- Phase 1: bodies laid out sequentially, separated by `glyphGap`. ---
    const bodyStarts: number[] = new Array(group.length);
    let cursor = this.offset;
    for (let i = 0; i < group.length; i++) {
      bodyStarts[i] = cursor;
      cursor += group[i]!.bodyDuration;
      if (i < group.length - 1) cursor += this.glyphGap;
    }
    const bodyEnd = cursor;

    // --- Phase 2: deferred dots, anchored after every body in the group. ---
    // Glyphs without dots contribute nothing to phase 2 and stay finished at
    // their body end; glyphs with dots get their entry duration stretched to
    // cover the dot phase.
    const hasAnyDots = group.some((p) => p.dotIndices.length > 0);
    const dotStarts: (number | undefined)[] = new Array(group.length);
    let groupEnd = bodyEnd;
    if (hasAnyDots) {
      cursor = bodyEnd + this.glyphGap;
      for (let i = 0; i < group.length; i++) {
        const p = group[i]!;
        if (p.dotIndices.length === 0) continue;
        dotStarts[i] = cursor;
        cursor += p.dotDuration + this.glyphGap;
      }
      // The trailing glyphGap past the last dot phase is intra-group spacing
      // that should not count; strip it.
      groupEnd = cursor - this.glyphGap;
    }

    // --- Emit each glyph's finalized entry. ---
    for (let i = 0; i < group.length; i++) {
      const p = group[i]!;
      const bodyStart = bodyStarts[i]!;
      const dotStart = dotStarts[i];

      let strokeDelays: (number | undefined)[] | undefined;
      let endTime = bodyStart + p.bodyDuration;
      if (dotStart !== undefined && p.dotIndices.length > 0) {
        // Rebuild a sparse per-stroke delay array. `dotIndices[k]` is the
        // absolute stroke index inside the glyph; its new effective delay
        // (relative to the entry's offset, i.e. the body start) re-anchors
        // it to the group-level dot phase while preserving the glyph's
        // intra-dot spacing.
        strokeDelays = [];
        for (let k = 0; k < p.dotIndices.length; k++) {
          const strokeIdx = p.dotIndices[k]!;
          strokeDelays[strokeIdx] = dotStart - bodyStart + (p.dotDelays[k]! - p.dotMinD);
        }
        endTime = dotStart + p.dotDuration;
      }

      this.entries.push({
        ...p.fields,
        offset: bodyStart,
        duration: endTime - bodyStart,
        ...(strokeDelays ? { strokeDelays } : {}),
      });
    }

    this.group.length = 0;
    this.offset = groupEnd;
    this.lastGap = 0;
  }
}

// ---------------------------------------------------------------------------
// Grapheme-path timeline (no shaper, iterate graphemes directly).
// ---------------------------------------------------------------------------

function computeGraphemeTimeline(text: string, font: TegakiBundle, config?: TimelineConfig): Timeline {
  const glyphGap = config?.glyphGap ?? DEFAULTS.glyphGap;
  const wordGap = config?.wordGap ?? DEFAULTS.wordGap;
  const lineGap = config?.lineGap ?? DEFAULTS.lineGap;
  const unknownDuration = config?.unknownDuration ?? DEFAULTS.unknownDuration;
  const deferDots = config?.deferDots ?? DEFAULTS.deferDots;

  const chars = graphemes(text);

  if (config?.stagger) {
    const staticDur = config.stagger.duration === 'auto' || config.stagger.duration === undefined ? undefined : config.stagger.duration;
    const sched = new StaggerScheduler(wordGap, lineGap, config.stagger.advance, staticDur);
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;
      const isLineBreak = char === '\n';
      const isWhitespace = !isLineBreak && /^\s+$/.test(char);
      if (isLineBreak) {
        sched.separator('line');
        continue;
      }
      if (isWhitespace) {
        sched.addMarker({ char, graphemeIndex: i, hasGlyph: false });
        sched.separator('word');
        continue;
      }
      const glyph = lookupGlyphData(font, char);
      if (glyph) {
        sched.addGlyph({ char, graphemeIndex: i, hasGlyph: true }, glyph.t ?? unknownDuration);
      } else {
        sched.addGlyph({ char, graphemeIndex: i, hasGlyph: false }, unknownDuration);
      }
    }
    return sched.finalize();
  }

  const sched = new Scheduler(glyphGap, wordGap, lineGap);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const isLineBreak = char === '\n';
    const isWhitespace = !isLineBreak && /^\s+$/.test(char);

    if (isLineBreak) {
      sched.separate('line');
      continue;
    }
    if (isWhitespace) {
      sched.separate('word', { fields: { char, graphemeIndex: i, hasGlyph: false }, duration: 0 });
      continue;
    }

    const glyph = lookupGlyphData(font, char);
    if (glyph) {
      const part = partitionGlyph(glyph, unknownDuration, deferDots);
      sched.add({
        fields: { char, graphemeIndex: i, hasGlyph: true },
        bodyDuration: part.bodyDuration,
        dotDuration: part.dotDuration,
        dotMinD: part.dotMinD,
        dotIndices: part.dotIndices,
        dotDelays: part.dotDelays,
      });
    } else {
      sched.add({
        fields: { char, graphemeIndex: i, hasGlyph: false },
        bodyDuration: unknownDuration,
        dotDuration: 0,
        dotMinD: 0,
        dotIndices: [],
        dotDelays: [],
      });
    }
  }

  return sched.finalize();
}

// ---------------------------------------------------------------------------
// Shaped-path timeline (harfbuzz clusters).
// ---------------------------------------------------------------------------

function computeShapedTimeline(text: string, font: TegakiBundle, config: TimelineConfig | undefined, shaper: BundleShaper): Timeline {
  const glyphGap = config?.glyphGap ?? DEFAULTS.glyphGap;
  const wordGap = config?.wordGap ?? DEFAULTS.wordGap;
  const lineGap = config?.lineGap ?? DEFAULTS.lineGap;
  const unknownDuration = config?.unknownDuration ?? DEFAULTS.unknownDuration;
  const deferDots = config?.deferDots ?? DEFAULTS.deferDots;

  // UTF-16 offset → grapheme index map. Shaper clusters come back in UTF-16
  // units; the renderer's layout indexes by grapheme. Map once per text.
  const chars = graphemes(text);
  const utf16ToGrapheme = new Int32Array(text.length + 1).fill(-1);
  {
    let u = 0;
    for (let i = 0; i < chars.length; i++) {
      utf16ToGrapheme[u] = i;
      u += chars[i]!.length;
    }
    utf16ToGrapheme[text.length] = chars.length;
  }

  const staggerSched = config?.stagger
    ? new StaggerScheduler(
        wordGap,
        lineGap,
        config.stagger.advance,
        config.stagger.duration === 'auto' || config.stagger.duration === undefined ? undefined : config.stagger.duration,
      )
    : null;
  const sched = staggerSched ? null : new Scheduler(glyphGap, wordGap, lineGap);

  // Shape each newline-delimited line separately so shaping never crosses a
  // break. This matches the DOM layout, which also breaks at `\n`.
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    if (!atEnd && text[i] !== '\n') continue;

    const lineText = text.slice(lineStart, i);
    if (lineText.length > 0) {
      const shaped = shaper.shape(lineText);
      // Harfbuzz emits glyphs in visual order (left-to-right on screen) regardless
      // of script direction. Sort by cluster offset so animation follows the
      // logical / reading order — matching how each script is actually
      // handwritten (right-to-left for Arabic/Hebrew, left-to-right for Latin).
      // Stable sort preserves intra-cluster glyph order (marks, ligature splits).
      const order = shaped.map((_, idx) => idx);
      order.sort((a, b) => shaped[a]!.cl - shaped[b]!.cl || a - b);
      for (let k = 0; k < order.length; k++) {
        const g = order[k]!;
        const glyph = shaped[g]!;
        const clusterStart = lineStart + glyph.cl;
        // Cluster extents run to the next cluster start in **logical** order
        // (i.e. the next entry in the sorted `order` array). Using the visual-
        // order neighbour works for LTR (cl ascending anyway) but yields
        // negative-length slices for RTL where cl descends.
        const nextOrder = k + 1 < order.length ? order[k + 1]! : -1;
        const clusterEnd = nextOrder >= 0 ? lineStart + shaped[nextOrder]!.cl : i;
        const graphemeIdx = utf16ToGrapheme[clusterStart] ?? -1;
        if (graphemeIdx < 0) continue; // cluster starts mid-grapheme — skip
        const clusterText = text.slice(clusterStart, clusterEnd);
        const firstChar = chars[graphemeIdx]!;
        const isWhitespace = /^\s+$/.test(clusterText);
        const data = font.glyphDataById?.[glyph.g] ?? lookupGlyphData(font, firstChar);
        const hasGlyph = !!data;

        if (isWhitespace) {
          if (staggerSched) {
            staggerSched.addMarker({ char: firstChar, graphemeIndex: graphemeIdx, glyphId: glyph.g, hasGlyph });
            staggerSched.separator('word');
          } else {
            sched!.separate('word', {
              fields: { char: firstChar, graphemeIndex: graphemeIdx, glyphId: glyph.g, hasGlyph },
              duration: 0,
            });
          }
          continue;
        }

        if (staggerSched) {
          const bundled = hasGlyph && data ? (data.t ?? unknownDuration) : unknownDuration;
          staggerSched.addGlyph({ char: firstChar, graphemeIndex: graphemeIdx, glyphId: glyph.g, hasGlyph: !!(hasGlyph && data) }, bundled);
        } else if (hasGlyph && data) {
          const part = partitionGlyph(data, unknownDuration, deferDots);
          sched!.add({
            fields: { char: firstChar, graphemeIndex: graphemeIdx, glyphId: glyph.g, hasGlyph: true },
            bodyDuration: part.bodyDuration,
            dotDuration: part.dotDuration,
            dotMinD: part.dotMinD,
            dotIndices: part.dotIndices,
            dotDelays: part.dotDelays,
          });
        } else {
          sched!.add({
            fields: { char: firstChar, graphemeIndex: graphemeIdx, glyphId: glyph.g, hasGlyph: false },
            bodyDuration: unknownDuration,
            dotDuration: 0,
            dotMinD: 0,
            dotIndices: [],
            dotDelays: [],
          });
        }
      }
    }

    if (!atEnd) {
      if (staggerSched) staggerSched.separator('line');
      else sched!.separate('line');
      lineStart = i + 1;
    }
  }

  return staggerSched ? staggerSched.finalize() : sched!.finalize();
}
