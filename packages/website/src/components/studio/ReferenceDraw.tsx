import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DRAWN_UNITS_PER_EM, type GeometryPipelineResult, renderGeometryStage } from 'tegaki-generator';
import { drawnDatasets, useDrawnDatasets } from '../preview/drawn-datasets.ts';
import { geometryStageFrame } from '../preview/stage-views.tsx';
import { PenIcon, PlusIcon, TrashIcon, UndoIcon } from './icons.tsx';
import { cx, GlyphKey, IconButton, isTypingTarget } from './ui.tsx';

// Drawing a stroke-order reference by hand, in the Reference stage: strokes
// drawn over the glyph go, in pen order, to the drawn dataset selected in the
// strip above the stage (drawn-datasets.ts), stored in thousandths of an em
// from the glyph's origin. The pipeline reruns with them as soon as a stroke
// is done, so the stage shows how the drawing registers and whether it wins.

type Stroke = [number, number][];

/** Pointer samples closer than this (thousandths of an em) are skipped. */
const MIN_STEP = 4;
/** Ramer–Douglas–Peucker tolerance a finished stroke is simplified to (thousandths of an em). */
const SIMPLIFY = 1.5;

function simplify(points: Stroke, tolerance: number): Stroke {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let worstD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const d = len > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (v: number) => Math.round(v * 10) / 10;

/** The strip above the Reference stage: which drawn dataset strokes go to, the pen, undo and clear. */
export function DrawStrip({
  char,
  drawing,
  onDrawingChange,
}: {
  /** The character drawings are for; null when the glyph draws no one letter (a ligature). */
  char: string | null;
  drawing: boolean;
  onDrawingChange: (on: boolean) => void;
}) {
  const { entries, selectedId } = useDrawnDatasets();
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const strokes = (char !== null && selected?.dataset.glyphs[char]) || [];

  // ⌘/Ctrl+Z takes the last stroke back while drawing.
  useEffect(() => {
    if (!drawing || !selected || char === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      drawnDatasets.undoStroke(selected.id, char);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, selected, char]);

  const togglePen = () => {
    if (!drawing && !selected) drawnDatasets.create();
    onDrawingChange(!drawing);
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <IconButton label={drawing ? 'Stop drawing' : 'Draw a reference'} active={drawing} disabled={char === null} onClick={togglePen}>
        <PenIcon size={14} />
      </IconButton>
      {entries.length > 0 ? (
        <select
          aria-label="Drawn dataset the strokes go to"
          title="Drawn dataset the strokes go to"
          value={selected?.id ?? ''}
          onChange={(e) => (e.target.value === '' ? drawnDatasets.create() : drawnDatasets.select(e.target.value))}
          className="h-7 max-w-40 min-w-0 truncate rounded-md border border-zinc-200 bg-white px-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.dataset.name}
              {e.enabled ? '' : ' (off)'}
            </option>
          ))}
          <option value="">New dataset…</option>
        </select>
      ) : (
        <button
          type="button"
          onClick={() => drawnDatasets.create()}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <PlusIcon size={12} /> New drawn dataset
        </button>
      )}
      {selected && char !== null && (
        <>
          <IconButton
            label="Undo the last stroke (⌘Z)"
            disabled={strokes.length === 0}
            onClick={() => drawnDatasets.undoStroke(selected.id, char)}
          >
            <UndoIcon size={14} />
          </IconButton>
          <IconButton
            label={`Clear the drawing of ${char}`}
            disabled={strokes.length === 0}
            onClick={() => drawnDatasets.clearGlyph(selected.id, char)}
          >
            <TrashIcon size={14} />
          </IconButton>
        </>
      )}
      <span className="ml-1 min-w-0 truncate text-zinc-500 dark:text-zinc-400">
        {char === null ? (
          'A ligature is ordered letter by letter — draw its letters'
        ) : !selected ? (
          'Draw the strokes in the order and direction you write them'
        ) : (
          <>
            {strokes.length} stroke{strokes.length === 1 ? '' : 's'} for <GlyphKey char={char} /> in {selected.dataset.name}
            {!selected.enabled && ' · switched off in Pipeline › References'}
            {drawing && strokes.length === 0 && ' · draw them in order, each in its direction'}
          </>
        )}
      </span>
    </div>
  );
}

/**
 * The Reference stage with a pen: the stage's art, and over it the selected
 * drawn dataset's strokes for `char` — numbered at their starts — while
 * drawing, the pointer adding one stroke per press.
 */
export function ReferenceStage({
  result,
  unitsPerEm,
  char,
  drawing,
}: {
  result: GeometryPipelineResult;
  unitsPerEm: number;
  char: string | null;
  drawing: boolean;
}) {
  const { vx, vy, vw, vh, width, height } = geometryStageFrame(result);
  const art = useMemo(
    () =>
      renderGeometryStage(result, 'reference')
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, ''),
    [result],
  );
  const { entries, selectedId } = useDrawnDatasets();
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const saved = (drawing && char !== null && selected?.dataset.glyphs[char]) || [];
  const [live, setLive] = useState<Stroke | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toEm = DRAWN_UNITS_PER_EM / unitsPerEm;
  const u = Math.max(vw, vh) / 400;

  /** The pointer in thousandths of an em from the glyph's origin. */
  const at = (e: PointerEvent): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [round(p.x * toEm), round(p.y * toEm)];
  };

  const canDraw = drawing && selected !== null && char !== null;
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!canDraw || e.button !== 0) return;
    const p = at(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLive([p]);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!live) return;
    const p = at(e);
    const last = live[live.length - 1]!;
    if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP) setLive([...live, p]);
  };
  const finish = (e: PointerEvent<SVGSVGElement>) => {
    if (!live) return;
    const p = at(e);
    const points = p && (p[0] !== live[live.length - 1]![0] || p[1] !== live[live.length - 1]![1]) ? [...live, p] : live;
    setLive(null);
    if (selected && char !== null) drawnDatasets.addStroke(selected.id, char, simplify(points, SIMPLIFY));
  };

  const shown = live ? [...saved, live] : saved;
  return (
    <svg
      ref={svgRef}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      className={cx('border border-gray-200', canDraw && 'cursor-crosshair touch-none')}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <title>Reference</title>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the stage art is our own renderer's SVG */}
      <g dangerouslySetInnerHTML={{ __html: art }} />
      {shown.map((stroke, i) => {
        const pts = stroke.map(([x, y]) => [x / toEm, y / toEm] as const);
        const [sx, sy] = pts[0]!;
        return (
          <g key={i} opacity={stroke === live ? 1 : 0.85}>
            {pts.length > 1 ? (
              <polyline
                points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="#4f46e5"
                strokeWidth={u * 3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle cx={sx} cy={sy} r={u * 3} fill="#4f46e5" />
            )}
            <circle cx={sx} cy={sy} r={u * 6} fill="#4f46e5" />
            <text x={sx} y={sy + u * 3} textAnchor="middle" fontSize={u * 8} fill="white" fontFamily="sans-serif">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
