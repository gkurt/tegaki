import type opentype from 'opentype.js';
import { useEffect, useMemo, useState } from 'react';
import {
  buildGsubGraph,
  createHbShaper,
  type FormExample,
  findFormExamples,
  type GlyphForm,
  type GsubGraph,
  glyphFormsOf,
  type HbShaper,
  type ParsedFontInfo,
} from 'tegaki-generator';
import type { LoadedFont } from './state.ts';
import { cx } from './ui.tsx';

/** Characters past which the glyph list skips counting forms (All in font on a CJK font). */
const MAX_COUNTED_CHARS = 4000;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The `glyphDataById` key of a glyph: `"<gid>"`, or `"<subset>:<gid>"` in an extra font subset. */
export function formKey(subset: number, gid: number): string {
  return subset === 0 ? String(gid) : `${subset}:${gid}`;
}

/** Every font subset of the loaded font (Google Fonts splits scripts into subsets): the primary first. */
function subsetFonts(fontInfo: ParsedFontInfo): opentype.Font[] {
  return [fontInfo.font, ...(fontInfo.extraFonts ?? [])];
}

/** The subset that maps `char` (-1 if none). */
function subsetOf(fontInfo: ParsedFontInfo, char: string): number {
  return subsetFonts(fontInfo).findIndex((f) => f.charToGlyphIndex(char) > 0);
}

/** The character's forms, from the font subset that maps it. */
export function formsOfChar(fontInfo: ParsedFontInfo, graphs: GsubGraph[], char: string): { subset: number; forms: GlyphForm[] } {
  const subset = subsetOf(fontInfo, char);
  const graph = graphs[subset];
  return subset < 0 || !graph ? { subset: 0, forms: [] } : { subset, forms: glyphFormsOf(graph, char) };
}

/** Each font subset's GSUB substitutions, read once per font. */
export function useGsubGraphs(fontInfo: ParsedFontInfo | null): GsubGraph[] {
  return useMemo(() => (fontInfo ? subsetFonts(fontInfo).map(buildGsubGraph) : []), [fontInfo]);
}

/**
 * A harfbuzz shaper for one font subset, applying the features the renderer
 * applies — the ground truth for which form a text draws. Null while it builds.
 */
function useFormShaper(font: LoadedFont | null, subset: number, disabledFeatures: readonly string[]): HbShaper | null {
  const features = useMemo(() => font?.info.features.filter((f) => !disabledFeatures.includes(f)) ?? [], [font, disabledFeatures]);
  const key = `${subset}:${features.join(',')}`;
  const [built, setBuilt] = useState<{ font: LoadedFont; key: string; shaper: HbShaper } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names `subset` and `features`
  useEffect(() => {
    const buffer = subset === 0 ? font?.buffer : font?.extraBuffers?.[subset - 1];
    if (!font || !buffer) return;
    let cancelled = false;
    createHbShaper(buffer, features)
      .then((shaper) => !cancelled && setBuilt({ font, key, shaper }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [font, key]);
  return built && built.font === font && built.key === key ? built.shaper : null;
}

export interface CharForms {
  /** The font subset holding the character (0 = primary). */
  subset: number;
  forms: GlyphForm[];
  /** A text that draws each form, by glyph id — null while the shaper builds. */
  examples: Map<number, FormExample> | null;
  /** The subset's shaper, for laying out example texts. */
  shaper: HbShaper | null;
}

/** The character's forms, and a text that draws each one. */
export function useCharForms(
  font: LoadedFont | null,
  graphs: GsubGraph[],
  char: string,
  chars: readonly string[],
  previewText: string,
  disabledFeatures: readonly string[],
): CharForms {
  const fontInfo = font?.info ?? null;
  const subset = useMemo(() => (fontInfo && char ? Math.max(subsetOf(fontInfo, char), 0) : 0), [fontInfo, char]);
  const graph = graphs[subset] ?? null;
  const shaper = useFormShaper(font, subset, disabledFeatures);
  const forms = useMemo(() => (graph && char ? glyphFormsOf(graph, char) : []), [graph, char]);
  // Contexts come from the same subset: the renderer shapes each subset's run on its own.
  const charset = useMemo(() => (graph ? chars.filter((c) => graph.font.charToGlyphIndex(c) > 0) : []), [graph, chars]);
  const words = useMemo(
    () => previewText.split(/\s+/u).filter((w) => w && graph && [...w].every((c) => graph.font.charToGlyphIndex(c) > 0)),
    [previewText, graph],
  );
  const examples = useMemo(
    () => (shaper && forms.length ? findFormExamples(forms, shaper.shape, { char, charset, words }) : null),
    [shaper, forms, char, charset, words],
  );
  return { subset, forms, examples, shaper };
}

/** How many forms each character has, for the glyph list's badges (empty past `MAX_COUNTED_CHARS`). */
export function useFormCounts(fontInfo: ParsedFontInfo | null, graphs: GsubGraph[], chars: readonly string[]): Map<string, number> {
  return useMemo(() => {
    const counts = new Map<string, number>();
    if (!fontInfo || chars.length > MAX_COUNTED_CHARS) return counts;
    for (const c of chars) {
      const n = formsOfChar(fontInfo, graphs, c).forms.length;
      if (n > 1) counts.set(c, n);
    }
    return counts;
  }, [fontInfo, graphs, chars]);
}

/** Width of `text` as the shaper lays it out, in em. */
export function shapedAdvanceEm(shaper: HbShaper, text: string, unitsPerEm: number): number {
  return shaper.shape(text).reduce((sum, g) => sum + g.ax, 0) / unitsPerEm;
}

/** The UTF-16 range of `example.text` drawn by `form`: its letters for a ligature, else one grapheme. */
export function exampleRange(form: GlyphForm, example: FormExample): { start: number; end: number } {
  const start = example.cluster;
  if (form.kind === 'ligature' && form.text && example.text.startsWith(form.text, start)) return { start, end: start + form.text.length };
  const grapheme = segmenter.segment(example.text.slice(start))[Symbol.iterator]().next().value?.segment ?? '';
  return { start, end: start + Math.max(grapheme.length, 1) };
}

const KIND_LABEL: Record<GlyphForm['kind'], string> = {
  default: 'default glyph',
  alternate: 'alternate',
  ligature: 'ligature',
  part: 'part',
};

/** The chip's short tag: the feature for an alternate, the letters for a ligature. */
export function formTag(form: GlyphForm): string {
  if (form.kind === 'default') return 'default';
  if (form.kind === 'ligature') return form.text ?? 'liga';
  if (form.kind === 'part') return 'part';
  return form.features.join('+') || 'alt';
}

/** Why a form is (not) drawn, for its tooltip and the Final stage. */
export function formStatus(form: GlyphForm, example: FormExample | undefined, disabledFeatures: readonly string[]): string {
  if (example) return `Drawn in “${example.text}”`;
  const off = form.features.filter((f) => disabledFeatures.includes(f));
  if (off.length) return `Not drawn: ${off.join(', ')} ${off.length > 1 ? 'are' : 'is'} off in Pipeline › Features`;
  return 'Not drawn by the renderer — no text tried brings it up (the shaper may not apply this feature to this script)';
}

export function formTitle(form: GlyphForm): string {
  const features = form.features.length ? ` (${form.features.join(', ')}${form.contextual ? ', contextual' : ''})` : '';
  return `${form.name} — ${KIND_LABEL[form.kind]}${features}`;
}

/** The glyph's outline, drawn from the font (a form has no character of its own to type). */
function GlyphArt({ fontInfo, subset, gid }: { fontInfo: ParsedFontInfo; subset: number; gid: number }) {
  const art = useMemo(() => {
    const { ascender, descender, unitsPerEm } = fontInfo;
    const glyph = subsetFonts(fontInfo)[subset]!.glyphs.get(gid);
    const path = glyph.getPath(0, 0, unitsPerEm);
    const box = path.getBoundingBox();
    const advance = glyph.advanceWidth ?? unitsPerEm / 2;
    const x1 = Math.min(0, box.x1);
    const x2 = Math.max(advance, box.x2);
    const y1 = Math.min(-ascender, box.y1);
    const y2 = Math.max(-descender, box.y2);
    return { d: path.toPathData(1), viewBox: `${x1} ${y1} ${x2 - x1} ${y2 - y1}`, aspect: (x2 - x1) / (y2 - y1) };
  }, [fontInfo, subset, gid]);
  return (
    <svg viewBox={art.viewBox} className="h-7" style={{ width: `${1.75 * art.aspect}rem` }} aria-hidden="true">
      <path d={art.d} fill="currentColor" />
    </svg>
  );
}

/**
 * The selected character's forms — its default glyph, alternates, ligatures
 * and parts — as a strip of chips. Forms the renderer never draws with the
 * current features are dimmed; the tooltip says why.
 */
export function FormStrip({
  fontInfo,
  subset,
  forms,
  examples,
  selected,
  disabledFeatures,
  onSelect,
}: {
  fontInfo: ParsedFontInfo;
  subset: number;
  forms: GlyphForm[];
  examples: Map<number, FormExample> | null;
  /** Glyph id of the selected form; the default when null. */
  selected: number | null;
  disabledFeatures: readonly string[];
  onSelect: (gid: number | null) => void;
}) {
  return (
    <div
      className="studio-scroll-x flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900"
      role="radiogroup"
      aria-label="Glyph forms"
    >
      <span className="shrink-0 px-1 text-[11px] font-medium text-zinc-400">Forms</span>
      {forms.map((form) => {
        const isDefault = form.kind === 'default';
        const isSelected = isDefault ? selected === null : selected === form.gid;
        const example = examples?.get(form.gid);
        const drawn = examples === null || !!example;
        return (
          <button
            key={form.gid}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(isDefault ? null : form.gid)}
            title={`${formTitle(form)}\n${examples === null ? 'Looking for a text that draws it…' : formStatus(form, example, disabledFeatures)}`}
            className={cx(
              'flex h-11 min-w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 transition-colors',
              isSelected
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
              !drawn && !isSelected && 'text-zinc-300 ring-1 ring-zinc-200 ring-inset dark:text-zinc-600 dark:ring-zinc-800',
            )}
          >
            <GlyphArt fontInfo={fontInfo} subset={subset} gid={form.gid} />
            <span className={cx('max-w-16 truncate font-mono text-[9px] leading-none', !isSelected && 'text-zinc-400')}>
              {formTag(form)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
