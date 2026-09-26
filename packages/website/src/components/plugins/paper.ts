import { type Box, createPlugin, type PlacedStroke, unionBoxes } from 'tegaki/core';

export type PaperStyle = 'ruled' | 'tian' | 'mi' | 'graph';

/** One line of text as the paper sees it: where its glyphs start and end, and its baseline, in text-box px. */
export interface PaperLine {
  left: number;
  right: number;
  baseline: number;
  /** The middle of the line's ink, up and down — where a practice square sits. */
  middle: number;
}

/** A practice square around one glyph. */
export interface PaperCell {
  x: number;
  y: number;
  size: number;
}

export interface PaperLayout {
  lines: PaperLine[];
  cells: PaperCell[];
}

/**
 * Where the paper's lines and squares go, from where the glyphs sit: a line
 * per baseline, spanning its glyphs' advances, and a square one em across
 * centred on each glyph's advance, at the middle of its line's ink. Glyphs
 * with no strokes (spaces) get no square.
 */
export function paperLayout(strokes: readonly PlacedStroke[], fontSize: number): PaperLayout {
  const byLine = new Map<number, { line: PaperLine; ink: (Box | null)[]; glyphs: Map<number, { x: number; advance: number }> }>();
  for (const s of strokes) {
    const { place } = s;
    const baseline = place.y + place.ascender * place.scale;
    const key = Math.round(baseline * 4);
    let entry = byLine.get(key);
    if (!entry) {
      entry = { line: { left: Infinity, right: -Infinity, baseline, middle: baseline }, ink: [], glyphs: new Map() };
      byLine.set(key, entry);
    }
    const advance = s.glyph.w * place.scale;
    entry.line.left = Math.min(entry.line.left, place.x);
    entry.line.right = Math.max(entry.line.right, place.x + advance);
    entry.ink.push(s.rawPath.bounds());
    entry.glyphs.set(s.entryIndex, { x: place.x, advance });
  }
  const lines: PaperLine[] = [];
  const cells: PaperCell[] = [];
  for (const { line, ink, glyphs } of byLine.values()) {
    const box = unionBoxes(ink);
    if (box) line.middle = (box.minY + box.maxY) / 2;
    lines.push(line);
    for (const g of glyphs.values()) cells.push({ x: g.x + g.advance / 2 - fontSize / 2, y: line.middle - fontSize / 2, size: fontSize });
  }
  lines.sort((a, b) => a.baseline - b.baseline);
  return { lines, cells };
}

/** Where a ruled line sits, in ems above the baseline: the capital line, and the dashed middle line small letters reach. */
const CAP = 0.7;
const MIDDLE = 0.35;
/** How far the rules run past the text, in ems. */
const RUN = 0.3;

/** The box the paper covers. */
export function paperBounds(layout: PaperLayout, style: PaperStyle, fontSize: number): Box | null {
  if (style === 'ruled' || style === 'graph') {
    return unionBoxes(
      layout.lines.map((l) => ({
        minX: l.left - RUN * fontSize,
        maxX: l.right + RUN * fontSize,
        minY: l.baseline - (CAP + 0.25) * fontSize,
        maxY: l.baseline + 0.35 * fontSize,
      })),
    );
  }
  return unionBoxes(layout.cells.map((c) => ({ minX: c.x, minY: c.y, maxX: c.x + c.size, maxY: c.y + c.size })));
}

/**
 * A practice sheet under the text, laid out by where its glyphs sit: school
 * ruled lines (capital line, dashed middle, baseline), a 田字格 or 米字格
 * square around each character — the grids Chinese and Japanese are
 * practised on — or graph paper. An `underlay`: clip-to-text doesn't cut it,
 * and it's under the ink. Each stroke knows where its glyph sits (`place`),
 * which is all the layout needs.
 */
export const paperPlugin = createPlugin({
  name: 'paper',
  label: 'Practice paper',
  description: 'Ruled lines, 田字格 / 米字格 squares or graph paper under the text, laid out by its glyphs. underlay + bounds.',
  params: {
    style: {
      type: 'select',
      label: 'Style',
      default: 'ruled',
      options: [
        { value: 'ruled', label: 'Ruled' },
        { value: 'tian', label: '田字格' },
        { value: 'mi', label: '米字格' },
        { value: 'graph', label: 'Graph' },
      ],
    },
    color: { type: 'color', label: 'Color', default: '#3b82f6' },
    opacity: { type: 'number', label: 'Opacity', default: 0.45, min: 0.05, max: 1, step: 0.05 },
  },
  presets: {
    Kanji: { style: 'mi', color: '#e5484d', opacity: 0.5 },
    Notebook: { style: 'graph', color: '#64748b', opacity: 0.35 },
  },
  setup: ({ style, color, opacity }) => {
    let cached: { first: PlacedStroke | undefined; count: number; fontSize: number; layout: PaperLayout } | null = null;
    const layoutOf = (strokes: readonly PlacedStroke[], fontSize: number) => {
      // Frames come and go, but their strokes stay where the layout put them.
      const first = strokes[0];
      if (cached?.first?.path !== first?.path || cached?.count !== strokes.length || cached?.fontSize !== fontSize) {
        cached = { first, count: strokes.length, fontSize, layout: paperLayout(strokes, fontSize) };
      }
      return cached.layout;
    };
    return {
      bounds: ({ strokes, fontSize }) => paperBounds(paperLayout(strokes, fontSize), style, fontSize),
      underlay({ ctx, frame, fontSize }) {
        const layout = layoutOf(frame.strokes, fontSize);
        const line = Math.max(1, fontSize * 0.012);
        const dash = [fontSize * 0.04, fontSize * 0.035];
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = line;
        const rule = (x0: number, y0: number, x1: number, y1: number, dashed = false, alpha = 1) => {
          ctx.setLineDash(dashed ? dash : []);
          ctx.globalAlpha = opacity * alpha;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        };
        if (style === 'ruled') {
          for (const l of layout.lines) {
            const x0 = l.left - RUN * fontSize;
            const x1 = l.right + RUN * fontSize;
            rule(x0, l.baseline - CAP * fontSize, x1, l.baseline - CAP * fontSize);
            rule(x0, l.baseline - MIDDLE * fontSize, x1, l.baseline - MIDDLE * fontSize, true, 0.8);
            rule(x0, l.baseline, x1, l.baseline);
          }
        } else if (style === 'graph') {
          const box = paperBounds(layout, style, fontSize);
          if (!box) return;
          const step = fontSize / 4;
          const snap = (v: number) => Math.floor(v / step) * step;
          for (let x = snap(box.minX); x <= box.maxX; x += step)
            rule(x, box.minY, x, box.maxY, false, Math.round(x / step) % 4 === 0 ? 1 : 0.45);
          for (let y = snap(box.minY); y <= box.maxY; y += step)
            rule(box.minX, y, box.maxX, y, false, Math.round(y / step) % 4 === 0 ? 1 : 0.45);
        } else {
          for (const c of layout.cells) {
            ctx.setLineDash([]);
            ctx.globalAlpha = opacity;
            ctx.strokeRect(c.x, c.y, c.size, c.size);
            const mx = c.x + c.size / 2;
            const my = c.y + c.size / 2;
            rule(mx, c.y, mx, c.y + c.size, true, 0.8);
            rule(c.x, my, c.x + c.size, my, true, 0.8);
            if (style === 'mi') {
              rule(c.x, c.y, c.x + c.size, c.y + c.size, true, 0.6);
              rule(c.x + c.size, c.y, c.x, c.y + c.size, true, 0.6);
            }
          }
        }
      },
    };
  },
});
