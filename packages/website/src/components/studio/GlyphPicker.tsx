import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GlyphBox, hitGlyph, measureGlyphBoxes, unionBox } from './glyph-hit.ts';
import { ArrowUpRightIcon } from './icons.tsx';
import { cx } from './ui.tsx';

const TEXT_LAYER = '[data-tegaki="overlay"]';
/** CSS highlight painting the picked characters' font glyphs — styled by `::highlight(tegaki-picked)` in studio.css. */
const HIGHLIGHT = 'tegaki-picked';

/**
 * Show the renderer's debug overlay (the font's own glyphs, drawn by the
 * transparent text layer) for just these characters. A CSS highlight colours
 * the ranges in place, so they keep the shaping the renderer laid out —
 * joined Arabic forms, kerning — which a copy of the character wouldn't.
 */
function useOverlayHighlight(rootRef: RefObject<HTMLElement | null>, boxes: (GlyphBox | null)[]) {
  const ranges = boxes.filter((b) => b !== null);
  const key = ranges.map((b) => `${b.offset}:${b.char}`).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the ranges
  useEffect(() => {
    const node = rootRef.current?.querySelector(TEXT_LAYER)?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || ranges.length === 0 || typeof CSS === 'undefined' || !CSS.highlights) return;
    const text = node.textContent ?? '';
    const highlight = new Highlight();
    for (const b of ranges) {
      // The boxes can trail an edit by a frame; skip ranges that no longer hold their character.
      if (text.slice(b.offset, b.offset + b.char.length) !== b.char) continue;
      const range = document.createRange();
      range.setStart(node, b.offset);
      range.setEnd(node, b.offset + b.char.length);
      highlight.add(range);
    }
    CSS.highlights.set(HIGHLIGHT, highlight);
    return () => {
      if (CSS.highlights.get(HIGHLIGHT) === highlight) CSS.highlights.delete(HIGHLIGHT);
    };
  }, [rootRef, key]);
}

/** The shaping cluster under a picked character, and the form of it the renderer drew. */
export interface PickedGlyph {
  /** Graphemes the cluster spans — several for a ligature. */
  start: number;
  end: number;
  /** The character to inspect: the cluster's first. */
  char: string;
  /** The form drawn (its `glyphDataById` key) when it isn't the character's default glyph. */
  form: string | null;
  /** Names that form, e.g. `a.ss01 · calt` or `ffi ligature`. */
  label: string | null;
}

/**
 * Wraps the text renderer so its characters can be picked: hovering outlines
 * the character under the pointer and shows its debug overlay, clicking
 * selects it, and the selected character carries a button that opens it in
 * the glyph inspector.
 */
export function GlyphPicker({
  children,
  onInspect,
  canInspect,
  pickGlyph,
}: {
  children: ReactNode;
  /** Open the character in the glyph inspector — on `form` when the renderer drew one of its forms. */
  onInspect: (char: string, form: string | null) => void;
  /** False for characters the font doesn't have — the inspector has nothing to show. */
  canInspect: (char: string) => boolean;
  /** The cluster and form drawn at a grapheme (see `PickedGlyph`); without it each character is picked alone. */
  pickGlyph?: (index: number) => PickedGlyph | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<GlyphBox[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // Re-measure whenever the text layer changes — new text, font, size, frame
  // width. Bursts of changes coalesce into one measurement.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remeasure = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      const root = rootRef.current;
      const layer = root?.querySelector<HTMLElement>(TEXT_LAYER);
      setBoxes(root && layer ? measureGlyphBoxes(layer, root.getBoundingClientRect()) : []);
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let layer: HTMLElement | null = null;
    const layerObserver = new MutationObserver(remeasure);
    const resize = new ResizeObserver(remeasure);
    resize.observe(root);
    // The renderer mounts its DOM once the font is ready — attach to the text layer when it appears.
    const attach = () => {
      const next = root.querySelector<HTMLElement>(TEXT_LAYER);
      if (next === layer) return;
      layerObserver.disconnect();
      if (layer) resize.unobserve(layer);
      layer = next;
      if (layer) {
        // Style carries font size, line height and letter spacing; the text node carries the text.
        layerObserver.observe(layer, { characterData: true, childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        resize.observe(layer);
      }
      remeasure();
    };
    const treeObserver = new MutationObserver(attach);
    treeObserver.observe(root, { childList: true, subtree: true });
    attach();
    document.fonts.addEventListener('loadingdone', remeasure);
    return () => {
      treeObserver.disconnect();
      layerObserver.disconnect();
      resize.disconnect();
      document.fonts.removeEventListener('loadingdone', remeasure);
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [remeasure]);

  // A picked character stands for its whole cluster: a ligature is outlined and picked as one.
  const pickAt = useCallback(
    (index: number | null): { box: GlyphBox; pick: PickedGlyph | null } | null => {
      if (index === null) return null;
      const pick = pickGlyph?.(index) ?? null;
      const box = pick ? unionBox(boxes, pick.start, pick.end, index) : boxes.find((b) => b.index === index);
      return box ? { box, pick } : null;
    },
    [boxes, pickGlyph],
  );

  // A selection that no longer lines up with the text (it was edited) is dropped.
  const selectedPick = useMemo(() => pickAt(selected), [pickAt, selected]);
  const selectedBox = selectedPick?.box ?? null;
  const selectedChar = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null) return;
    if (!selectedBox || selectedBox.char !== selectedChar.current) setSelected(null);
  }, [selected, selectedBox]);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const pointAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = rootRef.current?.getBoundingClientRect();
    return r ? hitGlyph(boxes, e.clientX - r.left, e.clientY - r.top) : null;
  };

  const hoveredPick = useMemo(() => pickAt(hovered), [pickAt, hovered]);
  const hoveredBox = !hoveredPick || hoveredPick.box.index === selectedBox?.index ? null : hoveredPick.box;
  const pickedChar = selectedPick?.pick?.char ?? selectedBox?.char ?? '';
  const selectedForm = selectedPick?.pick?.form ?? null;
  const formLabel = selectedPick?.pick?.label ?? null;
  const inspectable = selectedBox ? canInspect(pickedChar) : false;
  useOverlayHighlight(rootRef, [hoveredBox, selectedBox]);

  return (
    <div
      ref={rootRef}
      className={cx('relative', hovered !== null && 'cursor-pointer')}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        setHovered(pointAt(e)?.index ?? null);
      }}
      onPointerLeave={() => setHovered(null)}
      onClick={(e) => {
        // Leave real text selections alone.
        if (window.getSelection()?.toString()) return;
        const hit = pointAt(e);
        const box = hit ? (pickAt(hit.index)?.box ?? hit) : null;
        selectedChar.current = box?.char ?? null;
        setSelected(box && box.index !== selected ? box.index : null);
      }}
    >
      {children}

      {hoveredBox && <Box box={hoveredBox} className="bg-indigo-500/5 ring-1 ring-indigo-400/70 dark:ring-indigo-400/60" />}

      {selectedBox && (
        <>
          <Box box={selectedBox} className="bg-indigo-500/10 ring-2 ring-indigo-500 dark:bg-indigo-400/10 dark:ring-indigo-400" />
          <button
            type="button"
            disabled={!inspectable}
            onClick={(e) => {
              e.stopPropagation();
              onInspect(pickedChar, selectedForm);
            }}
            title={
              !inspectable
                ? `“${pickedChar}” isn't in this font`
                : formLabel
                  ? `Drawn as ${formLabel} — inspect it in Glyphs`
                  : `Inspect “${pickedChar}” in Glyphs`
            }
            aria-label={formLabel ? `Inspect ${formLabel} of “${pickedChar}” in Glyphs` : `Inspect “${pickedChar}” in Glyphs`}
            className={cx(
              'absolute z-10 inline-flex h-6 -translate-y-1/2 items-center justify-center gap-1 rounded-full bg-indigo-600 text-white shadow-md ring-2 ring-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-zinc-400 disabled:hover:scale-100 dark:ring-zinc-950',
              // A form's name rides along with the icon, which stays centred on the corner.
              formLabel ? '-ml-3 pr-2 pl-1.5' : 'w-6 -translate-x-1/2',
            )}
            style={{ left: selectedBox.x + selectedBox.width, top: selectedBox.y }}
          >
            <ArrowUpRightIcon size={13} className="shrink-0" />
            {formLabel && <span className="font-mono text-[10px] whitespace-nowrap">{formLabel}</span>}
          </button>
        </>
      )}
    </div>
  );
}

function Box({ box, className }: { box: GlyphBox; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('pointer-events-none absolute rounded-[3px]', className)}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  );
}
