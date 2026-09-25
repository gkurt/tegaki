import type opentype from 'opentype.js';

/**
 * How a form relates to the character it's listed under: its `default`
 * (cmap) glyph, an `alternate` that still draws the one letter (contextual,
 * positional or stylistic), a `ligature` drawing it together with other
 * letters, or a `part` it's decomposed into.
 */
export type GlyphFormKind = 'default' | 'alternate' | 'ligature' | 'part';

/** One glyph a character can be drawn with. */
export interface GlyphForm {
  gid: number;
  /** The font's glyph name (`a.ss01`, `f_i`), or `#<gid>` when it has none. */
  name: string;
  kind: GlyphFormKind;
  /** GSUB features whose lookups lead from the default glyph to this one — empty for the default. */
  features: string[];
  /** Reached through a contextual rule: the form appears only next to certain letters. */
  contextual: boolean;
  /** The text the glyph draws — the letter, or a ligature's letters. Unset for parts. */
  text?: string;
  /** Candidate example texts read off the font's rules (unverified — see `findFormExamples`). */
  hints: string[];
}

/** A text the shaper draws a form in, and where. */
export interface FormExample {
  text: string;
  /** UTF-16 offset of the cluster the form is drawn for. */
  cluster: number;
}

// ── GSUB graph ──────────────────────────────────────────────────────────────

type EdgeKind = 'single' | 'ligature' | 'multiple';

interface Edge {
  lookup: number;
  kind: EdgeKind;
  /** Every input glyph (all components, for a ligature). */
  input: number[];
  output: number[];
}

/** A chaining-context rule applying a nested lookup to `input[sequenceIndex]`. */
interface ContextRule {
  backtrack: number[][];
  input: number[][];
  lookahead: number[][];
  sequenceIndex: number;
}

/**
 * The font's GSUB substitutions as a graph over glyph ids, each edge tagged
 * with the features that reach its lookup. Build it once per font with
 * {@link buildGsubGraph} and query it per character with {@link glyphFormsOf}.
 */
export interface GsubGraph {
  font: opentype.Font;
  edgesFrom: Map<number, Edge[]>;
  /** Features that apply each lookup, directly or through a contextual lookup. */
  lookupFeatures: string[][];
  /** Lookups applied only through contextual rules. */
  lookupContextual: boolean[];
  /** Per nested lookup, the rules that apply it (coverage-based chaining rules only). */
  lookupRules: Map<number, ContextRule[]>;
  /** The letter each glyph draws: its cmap char, or one it's reached from by 1:1 substitutions. */
  letters: Map<number, string>;
}

interface Coverage {
  format: 1 | 2;
  glyphs?: number[];
  ranges?: { start: number; end: number; index: number }[];
}

interface LookupRecord {
  sequenceIndex: number;
  lookupListIndex: number;
}

// Loose shape of the opentype.js GSUB subtables read here.
interface Subtable {
  substFormat?: number;
  coverage?: Coverage;
  deltaGlyphId?: number;
  substitute?: number[];
  substitutes?: number[];
  sequences?: number[][];
  alternateSets?: number[][];
  ligatureSets?: { ligGlyph: number; components: number[] }[][];
  extensionLookupType?: number;
  extension?: Subtable;
  lookupRecords?: LookupRecord[];
  backtrackCoverage?: Coverage[];
  inputCoverage?: Coverage[];
  lookaheadCoverage?: Coverage[];
  coverages?: Coverage[];
  ruleSets?: ({ lookupRecords?: LookupRecord[] }[] | undefined)[];
  classSets?: ({ lookupRecords?: LookupRecord[] }[] | undefined)[];
  chainRuleSets?: ({ lookupRecords?: LookupRecord[] }[] | undefined)[];
  chainClassSet?: ({ lookupRecords?: LookupRecord[] }[] | undefined)[];
}

interface Gsub {
  lookups?: { lookupType: number; subtables?: Subtable[] }[];
  features?: { tag: string; feature: { lookupListIndexes: number[] } }[];
}

/** `aalt` lists every alternate for font menus — no shaper applies it. */
const MENU_FEATURES = new Set(['aalt']);

function expandCoverage(coverage: Coverage | undefined): number[] {
  if (!coverage) return [];
  if (coverage.format === 1) return coverage.glyphs ?? [];
  const out: number[] = [];
  for (const r of coverage.ranges ?? []) for (let g = r.start; g <= r.end; g++) out.push(g);
  return out;
}

/** Unwrap an extension (type 7) subtable to its real type. */
function unwrap(type: number, st: Subtable): [number, Subtable] {
  return type === 7 && st.extension && st.extensionLookupType !== undefined ? [st.extensionLookupType, st.extension] : [type, st];
}

function nestedRecords(st: Subtable): LookupRecord[] {
  const out = [...(st.lookupRecords ?? [])];
  for (const sets of [st.ruleSets, st.classSets, st.chainRuleSets, st.chainClassSet]) {
    for (const set of sets ?? []) for (const rule of set ?? []) out.push(...(rule.lookupRecords ?? []));
  }
  return out;
}

export function buildGsubGraph(font: opentype.Font): GsubGraph {
  const gsub = (font.tables as { gsub?: Gsub }).gsub;
  const lookups = gsub?.lookups ?? [];
  const featureSets = lookups.map(() => new Set<string>());
  const direct = lookups.map(() => false);
  for (const record of gsub?.features ?? []) {
    if (MENU_FEATURES.has(record.tag)) continue;
    for (const i of record.feature.lookupListIndexes) {
      featureSets[i]?.add(record.tag);
      direct[i] = true;
    }
  }

  // Contextual lookups hand their features to the lookups they apply, and
  // coverage-based chaining rules tell which letters around a glyph trigger it.
  const nested = new Map<number, Set<number>>();
  const lookupRules = new Map<number, ContextRule[]>();
  lookups.forEach((lookup, i) => {
    for (const raw of lookup.subtables ?? []) {
      const [type, st] = unwrap(lookup.lookupType, raw);
      if (type !== 5 && type !== 6) continue;
      for (const r of nestedRecords(st)) {
        if (!nested.has(i)) nested.set(i, new Set());
        nested.get(i)!.add(r.lookupListIndex);
      }
      if (type === 6 && st.substFormat === 3 && st.inputCoverage) {
        for (const r of st.lookupRecords ?? []) {
          const rules = lookupRules.get(r.lookupListIndex) ?? [];
          rules.push({
            backtrack: (st.backtrackCoverage ?? []).map(expandCoverage),
            input: st.inputCoverage.map(expandCoverage),
            lookahead: (st.lookaheadCoverage ?? []).map(expandCoverage),
            sequenceIndex: r.sequenceIndex,
          });
          lookupRules.set(r.lookupListIndex, rules);
        }
      }
    }
  });
  const reachedByContext = lookups.map(() => false);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [parent, children] of nested) {
      for (const child of children) {
        const set = featureSets[child];
        if (!set) continue;
        if (!reachedByContext[child]) {
          reachedByContext[child] = true;
          changed = true;
        }
        for (const tag of featureSets[parent] ?? []) {
          if (!set.has(tag)) {
            set.add(tag);
            changed = true;
          }
        }
      }
    }
  }

  const edgesFrom = new Map<number, Edge[]>();
  const addEdge = (from: number, edge: Edge) => {
    const list = edgesFrom.get(from);
    if (list) list.push(edge);
    else edgesFrom.set(from, [edge]);
  };
  lookups.forEach((lookup, i) => {
    for (const raw of lookup.subtables ?? []) {
      const [type, st] = unwrap(lookup.lookupType, raw);
      const covered = expandCoverage(st.coverage);
      covered.forEach((gid, idx) => {
        const one = (out: number | undefined) => {
          if (out !== undefined && out !== gid && out > 0) addEdge(gid, { lookup: i, kind: 'single', input: [gid], output: [out] });
        };
        if (type === 1)
          one(st.substFormat === 1 && st.deltaGlyphId !== undefined ? (gid + st.deltaGlyphId) & 0xffff : st.substitute?.[idx]);
        else if (type === 3) for (const out of st.alternateSets?.[idx] ?? []) one(out);
        else if (type === 8) one(st.substitutes?.[idx]);
        else if (type === 2) {
          const seq = st.sequences?.[idx];
          if (seq && seq.length > 1) addEdge(gid, { lookup: i, kind: 'multiple', input: [gid], output: seq });
          else one(seq?.[0]);
        } else if (type === 4) {
          for (const lig of st.ligatureSets?.[idx] ?? []) {
            const edge: Edge = { lookup: i, kind: 'ligature', input: [gid, ...lig.components], output: [lig.ligGlyph] };
            for (const g of new Set(edge.input)) addEdge(g, edge);
          }
        }
      });
    }
  });

  // Letters: cmap chars, then carried through 1:1 substitutions.
  const letters = new Map<number, string>();
  const cmap = (font.tables as { cmap?: { glyphIndexMap?: Record<string, number> } }).cmap?.glyphIndexMap ?? {};
  for (const [cp, gid] of Object.entries(cmap)) {
    const ch = String.fromCodePoint(Number(cp));
    const known = letters.get(gid);
    // Prefer the lowest codepoint (the plain letter over a compatibility duplicate).
    if (gid > 0 && (known === undefined || (known.codePointAt(0) ?? 0) > Number(cp))) letters.set(gid, ch);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [from, edges] of edgesFrom) {
      const letter = letters.get(from);
      if (letter === undefined) continue;
      for (const e of edges) {
        if (e.kind !== 'single' || letters.has(e.output[0]!)) continue;
        letters.set(e.output[0]!, letter);
        changed = true;
      }
    }
  }

  return {
    font,
    edgesFrom,
    lookupFeatures: featureSets.map((s) => [...s]),
    lookupContextual: reachedByContext.map((ctx, i) => ctx && !direct[i]),
    lookupRules,
    letters,
  };
}

// ── Forms of one character ──────────────────────────────────────────────────

/** Forms listed per character at most — a letter can join hundreds of Arabic ligatures. */
const MAX_FORMS = 120;

const KIND_ORDER: Record<GlyphFormKind, number> = { default: 0, alternate: 1, ligature: 2, part: 3 };

/**
 * Every glyph `char` can be drawn with: its default glyph, the alternates
 * GSUB swaps in for it, the ligatures it's a component of (with the other
 * components' letters), and the parts it decomposes into. Ordered default →
 * alternates → ligatures (shortest first) → parts.
 */
export function glyphFormsOf(graph: GsubGraph, char: string): GlyphForm[] {
  const { font } = graph;
  const start = font.charToGlyphIndex(char);
  if (!start) return [];
  const glyphName = (gid: number) => font.glyphs.get(gid)?.name || `#${gid}`;
  const forms = new Map<number, GlyphForm>();
  forms.set(start, { gid: start, name: glyphName(start), kind: 'default', features: [], contextual: false, text: char, hints: [] });

  const queue = [start];
  while (queue.length && forms.size < MAX_FORMS) {
    const from = forms.get(queue.shift()!)!;
    for (const edge of graph.edgesFrom.get(from.gid) ?? []) {
      let kind: GlyphFormKind;
      let text: string | undefined;
      if (edge.kind === 'ligature') {
        // The other components must draw letters too, so the ligature can be typed.
        const parts = edge.input.map((g) => (g === from.gid ? from.text : graph.letters.get(g)));
        if (parts.some((p) => p === undefined) || from.kind === 'part') continue;
        kind = 'ligature';
        text = parts.join('');
      } else if (edge.kind === 'multiple' || from.kind === 'part') {
        kind = 'part';
      } else {
        kind = from.kind === 'default' ? 'alternate' : from.kind;
        text = from.text;
      }
      const features = [...new Set([...from.features, ...(graph.lookupFeatures[edge.lookup] ?? [])])];
      const contextual = from.contextual || (graph.lookupContextual[edge.lookup] ?? false);
      const hints = contextHints(graph, edge, from.gid, char);
      if (kind === 'ligature' && text) hints.unshift(text);
      for (const gid of edge.output) {
        if (forms.has(gid) || forms.size >= MAX_FORMS) continue;
        forms.set(gid, { gid, name: glyphName(gid), kind, features, contextual, ...(text === undefined ? {} : { text }), hints });
        queue.push(gid);
      }
    }
  }
  return [...forms.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.text?.length ?? 0) - (b.text?.length ?? 0));
}

/**
 * Texts that may trigger `edge` on `source`, read off the chaining rules that
 * apply its lookup: each context position takes `source`'s own letter when it
 * fits (Caveat's alternates answer a repeated letter), else the first glyph
 * there that draws a letter.
 */
function contextHints(graph: GsubGraph, edge: Edge, source: number, char: string): string[] {
  const rules = graph.lookupRules.get(edge.lookup);
  if (!rules) return [];
  const hints: string[] = [];
  const pick = (glyphs: number[]): string | undefined => {
    if (glyphs.includes(source)) return graph.letters.get(source) ?? char;
    let best: string | undefined;
    for (const g of glyphs) {
      const letter = graph.letters.get(g);
      if (letter !== undefined && (best === undefined || contextRank(letter) < contextRank(best))) best = letter;
    }
    return best;
  };
  for (const rule of rules) {
    if (!rule.input[rule.sequenceIndex]?.includes(source)) continue;
    const parts = [...[...rule.backtrack].reverse(), ...rule.input, ...rule.lookahead].map((glyphs, i) =>
      i === rule.backtrack.length + rule.sequenceIndex ? (graph.letters.get(source) ?? char) : pick(glyphs),
    );
    if (parts.every((p) => p !== undefined)) hints.push(parts.join(''));
    if (hints.length >= 4) break;
  }
  return hints;
}

// Arabic letters that join only to the letter before them, ending a joined run.
const RIGHT_JOINING = new Set([...'ءآأؤإاةدذرزوىٱٲٳٵ']);

/**
 * Which letter makes the plainest context: caseless or lowercase letters
 * first (dual-joining ones, for Arabic), then capitals, then the rest — each
 * by codepoint, so basic letters come before extended ones.
 */
function contextRank(letter: string): number {
  const cp = letter.codePointAt(0) ?? 0;
  if (!/\p{L}/u.test(letter)) return 0x300000 + cp;
  if (/\p{Lu}/u.test(letter) || RIGHT_JOINING.has(letter)) return 0x200000 + cp;
  return cp;
}

// ── Examples ────────────────────────────────────────────────────────────────

/** A shaper that returns glyph ids and cluster offsets, like `HbShaper.shape`. */
export type ShapeFn = (text: string) => readonly { g: number; cl: number }[];

export interface FindExamplesOptions {
  /** The character whose forms these are. */
  char: string;
  /** Characters to try around it — the studio's character set. */
  charset: readonly string[];
  /** Words to try first — the preview text's. */
  words?: readonly string[];
  /** Most texts to shape. */
  budget?: number;
}

const TATWEEL = 'ـ';
const ARABIC = /\p{Script=Arabic}/u;

/**
 * A text the shaper really draws each form in — shaping is the ground truth,
 * whatever the rules suggest. Tries the character alone, the forms' hints,
 * repeats of it, `words` that contain it, then the character next to each
 * member of `charset`. Forms without an entry never came up: they're behind a
 * feature the shaper doesn't apply, or need a context not tried.
 */
export function findFormExamples(forms: readonly GlyphForm[], shape: ShapeFn, options: FindExamplesOptions): Map<number, FormExample> {
  const { char, charset, words = [], budget = 3000 } = options;
  const found = new Map<number, FormExample>();
  const wanted = new Set(forms.map((f) => f.gid));
  const tried = new Set<string>();
  let spent = 0;

  const attempt = (text: string): boolean => {
    if (!text || tried.has(text)) return found.size < wanted.size && spent < budget;
    tried.add(text);
    spent++;
    for (const g of shape(text)) {
      if (wanted.has(g.g) && !found.has(g.g)) found.set(g.g, { text, cluster: g.cl });
    }
    return found.size < wanted.size && spent < budget;
  };

  function* candidates(): Generator<string> {
    yield char;
    yield* [char.repeat(2), char.repeat(3)];
    for (const f of forms) {
      if (f.text) yield f.text;
      yield* f.hints;
    }
    for (let n = 4; n <= 6; n++) yield char.repeat(n);
    if (ARABIC.test(char)) yield* [TATWEEL + char, char + TATWEEL, TATWEEL + char + TATWEEL];
    for (const w of words) if (w.includes(char)) yield w;
    const others = charset.filter((c) => c !== char && !/\s/u.test(c)).sort((a, b) => contextRank(a) - contextRank(b));
    for (const x of others) yield* [char + x, x + char];
    for (const x of others) {
      yield* [x + x + char, char + x + char];
      for (const y of others.slice(0, 24)) yield x + char + y;
    }
  }

  for (const text of candidates()) if (!attempt(text)) break;
  return found;
}
