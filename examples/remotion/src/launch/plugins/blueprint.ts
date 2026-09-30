import { createPlugin, expandBox, offsetPath, type StrokePath } from 'tegaki/core';
import { memo, smooth, textBounds } from './util.ts';

/**
 * A blueprint: each stroke drafted as its two edges and a dashed centerline,
 * the ends circled, on guide lines for the baseline and x-height, a
 * dimension line measuring the word once it's done, and a crosshair at the
 * pen reading out where it is.
 */
export const blueprint = createPlugin({
  name: 'blueprint',
  params: {
    color: { type: 'color', default: '#e8f1ff' },
  },
  setup: ({ color }) => {
    const edges = memo((path: StrokePath) => {
      if (path.points.length < 2) return null;
      const half = (p: { width: number }) => p.width / 2;
      return [
        offsetPath(path, half).map((p) => ({ ...p, width: 1.6 })),
        offsetPath(path, (p) => -half(p)).map((p) => ({ ...p, width: 1.6 })),
      ];
    });
    return {
      bounds: ({ strokes, fontSize }) => expandBox(textBounds(strokes), fontSize * 0.45),
      paint(s, next) {
        const { stroke, ctx } = s;
        if (stroke.state === 'pending') return;
        const e = edges(stroke.path);
        const pts = stroke.path.points;
        if (e) for (const edge of e) next({ ...s, style: color, stroke: { ...stroke, path: edge, nibs: [] } });
        // The centerline, dashed.
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        const last = stroke.path.lastIndexAt(stroke.progress);
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i <= last; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        const head = stroke.path.pointAt(stroke.progress);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        // The ends: a circle at the start, one at the end once it's reached.
        const w0 = pts[0]!.width / 2;
        ctx.beginPath();
        ctx.arc(pts[0]!.x, pts[0]!.y, Math.max(3, w0), 0, Math.PI * 2);
        ctx.stroke();
        if (stroke.state === 'done') {
          const pe = pts[pts.length - 1]!;
          ctx.beginPath();
          ctx.arc(pe.x, pe.y, Math.max(3, pe.width / 2), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      },
      underlay({ ctx, frame, fontSize }) {
        const box = textBounds(frame.strokes);
        const first = frame.strokes[0];
        if (!box || !first) return;
        const baseline = first.place.y + first.place.ascender * first.place.scale;
        const x0 = box.minX - fontSize * 0.35;
        const x1 = box.maxX + fontSize * 0.35;
        const grow = smooth(0, 0.6, frame.time);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.font = `${Math.round(fontSize * 0.075)}px "Geist Mono", monospace`;
        const guide = (y: number, label: string) => {
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([2, 6]);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + (x1 - x0) * grow, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.6 * grow;
          ctx.fillText(label, x0, y - 5);
        };
        guide(baseline, 'BASELINE');
        guide(baseline - fontSize * 0.34, 'X-HEIGHT');
        // The dimension line, once the pen is done.
        const end = frame.strokes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
        const d = smooth(end, end + 0.5, frame.time);
        if (d <= 0) return;
        const y = box.maxY + fontSize * 0.16;
        const mid = (box.minX + box.maxX) / 2;
        const half = ((box.maxX - box.minX) / 2) * d;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(mid - half, y);
        ctx.lineTo(mid + half, y);
        for (const x of [mid - half, mid + half]) {
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x, y + 7);
        }
        ctx.stroke();
        const label = `${Math.round(box.maxX - box.minX)} px`;
        const tw = ctx.measureText(label).width;
        ctx.globalAlpha = d;
        ctx.fillText(label, mid - tw / 2, y + fontSize * 0.1);
      },
      overlay({ ctx, frame, fontSize }) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.font = `${Math.round(fontSize * 0.07)}px "Geist Mono", monospace`;
        for (const a of frame.active) {
          if (a.progress <= 0 || a.progress >= 1) continue;
          const { x, y } = a.head;
          const r = fontSize * 0.07;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.moveTo(x - r * 2, y);
          ctx.lineTo(x + r * 2, y);
          ctx.moveTo(x, y - r * 2);
          ctx.lineTo(x, y + r * 2);
          ctx.stroke();
          ctx.fillText(`${Math.round(x)}, ${Math.round(y)}`, x + r * 1.6, y - r * 1.4);
        }
      },
    };
  },
});
