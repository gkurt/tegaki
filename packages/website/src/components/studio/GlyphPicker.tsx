import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type GlyphBox, hitGlyph, measureGlyphBoxes } from './glyph-hit.ts';
import { ArrowUpRightIcon } from './icons.tsx';
import { cx } from './ui.tsx';

const TEXT_LAYER = '[data-tegaki="overlay"]';

/**
 * Wraps the text renderer so its characters can be picked: hovering outlines
 * the character under the pointer, clicking selects it, and the selected
 * character carries a button that opens it in the glyph inspector.
 */
export function GlyphPicker({
  children,
  onInspect,
  canInspect,
}: {
  children: ReactNode;
  onInspect: (char: string) => void;
  /** False for characters the font doesn't have — the inspector has nothing to show. */
  canInspect: (char: string) => boolean;
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

  // A selection that no longer lines up with the text (it was edited) is dropped.
  const selectedBox = selected === null ? null : (boxes.find((b) => b.index === selected) ?? null);
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

  const hoveredBox = hovered === null || hovered === selected ? null : (boxes.find((b) => b.index === hovered) ?? null);
  const inspectable = selectedBox ? canInspect(selectedBox.char) : false;

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
        selectedChar.current = hit?.char ?? null;
        setSelected(hit && hit.index !== selected ? hit.index : null);
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
              onInspect(selectedBox.char);
            }}
            title={inspectable ? `Inspect “${selectedBox.char}” in Glyphs` : `“${selectedBox.char}” isn't in this font`}
            aria-label={`Inspect “${selectedBox.char}” in Glyphs`}
            className="absolute z-10 inline-flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md ring-2 ring-white transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:bg-zinc-400 disabled:hover:scale-100 dark:ring-zinc-950"
            style={{ left: selectedBox.x + selectedBox.width, top: selectedBox.y }}
          >
            <ArrowUpRightIcon size={13} />
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
