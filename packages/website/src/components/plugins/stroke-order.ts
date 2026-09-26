import {
  type Box,
  clearance,
  createPlugin,
  expandBox,
  inkEdge,
  offsetPath,
  paintStroke,
  type StrokeFrame,
  type StrokePath,
  unionBoxes,
} from 'tegaki/core';

/** Where a stroke's guide goes: its number, and the arrow alongside it (none for a dot or a very short stroke). */
export interface StrokeGuide {
  number: { x: number; y: number };
  arrow: StrokePath | null;
}

/** Sizes, in ems. */
const GAP = 0.06;
const BADGE = 0.05;
const ARROW_LENGTH = 0.45;
const MIN_ARROW_STROKE = 0.22;

/**
 * Lay out one glyph's stroke-order guides: for each stroke, an arrow running
 * beside its first stretch, a safe gap off the ink on whichever side has more
 * room, and a number close by its start, clear of the ink, the arrows and the
 * numbers already placed. `strokes` are the glyph's strokes in order;
 * `neighbours`, ink of the glyphs around it to keep clear of too.
 */
export function layoutGuides(
  strokes: readonly { path: StrokePath }[],
  fontSize: number,
  neighbours: readonly StrokePath[] = [],
): StrokeGuide[] {
  const paths = strokes.map((s) => s.path);
  const ink = [...paths, ...neighbours];
  const gap = GAP * fontSize;
  const arrows = paths.map((path) => {
    if (path.points.length < 2 || path.length < MIN_ARROW_STROKE * fontSize) return null;
    const stretch = path.slice(0.04, Math.min(0.55, 0.04 + (ARROW_LENGTH * fontSize) / path.length));
    let best: StrokePath | null = null;
    let bestRoom = -Infinity;
    for (const side of [1, -1] as const) {
      const arrow = offsetPath(stretch, inkEdge(gap, side));
      let room = Infinity;
      for (const p of arrow.points) room = Math.min(room, clearance(p, ink));
      if (room > bestRoom) {
        bestRoom = room;
        best = arrow;
      }
    }
    return best;
  });

  const badge = BADGE * fontSize;
  const avoid = [...ink, ...arrows.filter((a): a is StrokePath => a !== null).map((a) => a.map((p) => ({ ...p, width: 2 })))];
  const numbers: { x: number; y: number }[] = [];
  return paths.map((path, i) => {
    const start = path.pointAt(0);
    const back = start.angle + Math.PI;
    let best = { x: start.x, y: start.y };
    let bestScore = -Infinity;
    for (const [level, reach] of [0.4, 1, 1.8].entries()) {
      const r = start.width / 2 + badge + gap * reach;
      for (let k = -7; k <= 8; k++) {
        const a = back + (k * Math.PI) / 8;
        const p = { x: start.x + Math.cos(a) * r, y: start.y + Math.sin(a) * r };
        let room = clearance(p, avoid) - badge;
        for (const n of numbers) room = Math.min(room, Math.hypot(p.x - n.x, p.y - n.y) - 2 * badge - gap * 0.3);
        // Anywhere clear will do; then nearest the start, then behind it.
        const score = (room >= 0 ? 0 : 10 * room) - 0.03 * fontSize * level - 0.002 * fontSize * Math.abs(k);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    numbers.push(best);
    return { number: best, arrow: arrows[i]! };
  });
}

/**
 * Stroke order, the way a writing worksheet shows it: every stroke numbered
 * where it starts over a faint tracing of the text, an arrow beside the
 * stroke being drawn in the direction it goes (in the accent, like its
 * number), and a faint one beside the stroke that comes next.
 */
export const strokeOrderPlugin = createPlugin({
  name: 'stroke-order',
  label: 'Stroke order',
  description: 'Numbers and arrows beside each stroke, kept clear of the ink, over a faint tracing of the text. underlay + overlay.',
  params: {
    accent: { type: 'color', label: 'Accent', default: '#e5484d' },
    numbers: { type: 'boolean', label: 'Numbers', default: true },
    arrows: { type: 'boolean', label: 'Arrows', default: true },
    tracing: {
      type: 'number',
      label: 'Tracing',
      description: 'How strongly the text to come shows under the ink.',
      default: 0.13,
      min: 0,
      max: 0.5,
      step: 0.01,
    },
  },
  presets: {
    'Numbers only': { arrows: false, tracing: 0 },
    'Tracing only': { numbers: false, arrows: false, tracing: 0.25 },
  },
  setup: ({ accent, numbers, arrows, tracing }) => {
    const guides = new WeakMap<StrokePath, StrokeGuide>();
    const guideFor = (stroke: StrokeFrame, all: readonly StrokeFrame[], fontSize: number) => {
      let guide = guides.get(stroke.path);
      if (!guide) {
        const glyph = all.filter((s) => s.entryIndex === stroke.entryIndex).sort((a, b) => a.strokeIndex - b.strokeIndex);
        const near = expandBox(unionBoxes(glyph.map((s) => s.path.bounds())), fontSize * 0.5);
        const neighbours = all.filter((s) => s.entryIndex !== stroke.entryIndex && overlaps(s.path.bounds(), near)).map((s) => s.path);
        const laid = layoutGuides(glyph, fontSize, neighbours);
        for (let i = 0; i < glyph.length; i++) guides.set(glyph[i]!.path, laid[i]!);
        guide = guides.get(stroke.path)!;
      }
      return guide;
    };

    return {
      bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 0.3),
      underlay: ({ ctx, frame, color }) => {
        if (tracing <= 0) return;
        ctx.globalAlpha = tracing;
        for (const s of frame.strokes) paintStroke({ ctx, stroke: { ...s, state: 'done', progress: 1 }, style: color, lineCap: 'round' });
      },
      overlay: ({ ctx, frame, fontSize, color }) => {
        if (!numbers && !arrows) return;
        const badge = BADGE * fontSize;
        const line = Math.max(1, 0.014 * fontSize);
        let next: StrokeFrame | undefined;
        for (const s of frame.strokes) if (s.state === 'pending' && (!next || s.start < next.start)) next = s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const s of frame.strokes) {
          const { number, arrow } = guideFor(s, frame.strokes, fontSize);
          const drawing = s.state === 'drawing';
          if (arrows && arrow && (drawing || s === next)) {
            ctx.globalAlpha = drawing ? 1 : 0.35;
            drawArrow(ctx, arrow, drawing ? accent : color, line, badge);
          }
          if (!numbers) continue;
          ctx.beginPath();
          ctx.arc(number.x, number.y, badge, 0, Math.PI * 2);
          if (s.state === 'pending') {
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = line;
            ctx.strokeStyle = color;
            ctx.stroke();
          } else {
            ctx.globalAlpha = drawing ? 1 : 0.5;
            ctx.fillStyle = drawing ? accent : color;
            ctx.fill();
          }
          const label = String(s.strokeIndex + 1);
          ctx.globalAlpha = s.state === 'pending' ? 0.6 : 1;
          ctx.fillStyle = s.state === 'pending' ? color : '#fff';
          ctx.font = `600 ${badge * (label.length > 1 ? 1.05 : 1.3)}px system-ui, sans-serif`;
          ctx.fillText(label, number.x, number.y + badge * 0.06);
        }
      },
    };
  },
});

function overlaps(a: Box | null, b: Box | null): boolean {
  return !!a && !!b && a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function drawArrow(ctx: CanvasRenderingContext2D, arrow: StrokePath, style: string, width: number, head: number) {
  const pts = arrow.points;
  ctx.strokeStyle = style;
  ctx.fillStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();
  const tip = arrow.pointAt(1);
  ctx.beginPath();
  ctx.moveTo(tip.x + Math.cos(tip.angle) * head * 0.4, tip.y + Math.sin(tip.angle) * head * 0.4);
  ctx.lineTo(tip.x + Math.cos(tip.angle + 2.5) * head, tip.y + Math.sin(tip.angle + 2.5) * head);
  ctx.lineTo(tip.x + Math.cos(tip.angle - 2.5) * head, tip.y + Math.sin(tip.angle - 2.5) * head);
  ctx.closePath();
  ctx.fill();
}
