import { type Box, createPlugin, expandBox, type StrokeFrame, seededRandom, unionBoxes } from 'tegaki/core';
import { canvasColor, mix, type Rgba, rgba } from './color.ts';
import { inkRegion, scratchCanvas, shrunk } from './ink-canvas.ts';
import { inkAge } from './wet.ts';

export type LaserOrigin = 'top' | 'left' | 'right' | 'bottom';

/** Where the beam comes from: off the text on one side, about an em and a half away, level with its middle. */
export function emitterAt(ink: Box, origin: LaserOrigin, fontSize: number): { x: number; y: number } {
  const cx = (ink.minX + ink.maxX) / 2;
  const cy = (ink.minY + ink.maxY) / 2;
  const away = 1.5 * fontSize;
  switch (origin) {
    case 'top':
      return { x: cx, y: ink.minY - away };
    case 'bottom':
      return { x: cx, y: ink.maxY + away };
    case 'left':
      return { x: ink.minX - away, y: cy };
    case 'right':
      return { x: ink.maxX + away, y: cy };
  }
}

/**
 * The color of laser-drawn ink `age` seconds after the beam passed it:
 * white-hot (tinted by the beam), cooling through the beam's color to `final` over `cool`
 * seconds (to the beam's color for a light show, to char when engraving).
 */
export function cooled(age: number, cool: number, beam: Rgba, final: Rgba): Rgba {
  // Nearly white, with a tint of the beam so it still shows on light paper.
  const hot = mix([255, 255, 255, 1], beam, 0.25);
  if (age <= 0) return hot;
  const f = cool > 0 ? age / cool : 1;
  if (f < 0.25) return mix(hot, beam, f / 0.25);
  return mix(beam, final, Math.min(1, (f - 0.25) / 0.75));
}

/** Char, for an engraving's burnt line. */
const CHAR: Rgba = [46, 26, 14, 1];

/**
 * Written by a laser: a beam from off the text to the point being drawn,
 * a flare and sparks where it hits, and the line it leaves glowing
 * white-hot and cooling — to the beam's color for a light show, to char
 * for an engraving. The beam and sparks are an `overlay` (from the frame
 * alone, so scrubbing shows the same sparks); the cooling line is `paint`
 * (from the paint context's `time`); the glow is an `ink` hook; `bounds`
 * makes room for the emitter.
 */
export const laserPlugin = createPlugin({
  name: 'laser',
  label: 'Laser',
  description: 'A beam writes the text, sparking where it hits, the line glowing hot and cooling. overlay + paint + ink + bounds.',
  params: {
    color: { type: 'color', label: 'Color', default: '#ff2a2a' },
    origin: {
      type: 'select',
      label: 'From',
      default: 'top',
      options: [
        { value: 'top', label: 'Above' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'bottom', label: 'Below' },
      ],
    },
    beam: { type: 'number', label: 'Beam', description: "The beam's width, in ems.", default: 0.012, min: 0.003, max: 0.04, step: 0.001 },
    glow: { type: 'number', label: 'Glow', default: 0.7, min: 0, max: 1, step: 0.05 },
    cool: { type: 'number', label: 'Cooling', description: 'Seconds the line takes to cool.', default: 0.9, min: 0.1, max: 4, step: 0.1 },
    burn: { type: 'boolean', label: 'Engrave', description: 'Burn the line in: it cools to char.', default: false },
    sparks: { type: 'boolean', label: 'Sparks', default: true },
  },
  presets: {
    Green: { color: '#39ff14' },
    Blue: { color: '#2f7bff', origin: 'left' },
    Engraver: { color: '#ffb347', burn: true, glow: 0.4, cool: 1.6 },
  },
  setup: ({ color, origin, beam, glow, cool, burn, sparks }) => {
    let lit: Rgba | null = null;
    const blur = scratchCanvas();
    // The emitter is placed off the whole text, so it holds still as the text is written.
    let emitter: { first: unknown; point: { x: number; y: number } } | null = null;
    const emitterFor = (strokes: readonly StrokeFrame[], fontSize: number) => {
      if (emitter?.first !== strokes[0]?.path) {
        const box = unionBoxes(strokes.map((s) => s.path.bounds())) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        emitter = { first: strokes[0]?.path, point: emitterAt(box, origin, fontSize) };
      }
      return emitter.point;
    };
    return {
      bounds: ({ strokes, fontSize }) => {
        const box = unionBoxes(strokes.map((s) => s.path.bounds()));
        if (!box) return null;
        const e = emitterAt(box, origin, fontSize);
        return expandBox(unionBoxes([box, { minX: e.x, minY: e.y, maxX: e.x, maxY: e.y }]), fontSize * 0.25);
      },
      paint(s, next) {
        lit ??= canvasColor(s.ctx, color) ?? [255, 42, 42, 1];
        const beamColor = lit;
        const final = burn ? CHAR : beamColor;
        const { stroke, time } = s;
        const age = (t: number) => inkAge(stroke, t, time);
        const allCool = age(stroke.progress) >= cool;
        next({ ...s, style: allCool ? rgba(final) : (t) => rgba(cooled(age(t), cool, beamColor, final)) });
      },
      ink({ ctx, ink, bounds, fontSize }) {
        if (glow <= 0 || burn) return;
        const k = ctx.getTransform().a;
        const r = inkRegion(ctx, ink, bounds, 0.2 * fontSize * k + 2);
        if (!r) return;
        const soft = shrunk(blur(1, 1), ink, r, Math.max(2, 0.06 * fontSize * k));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.globalCompositeOperation = 'destination-over';
        ctx.globalAlpha = glow;
        ctx.drawImage(soft.canvas, 0, 0, soft.w, soft.h, r.x, r.y, r.w, r.h);
      },
      overlay({ ctx, frame, fontSize }) {
        if (frame.active.length === 0) return;
        lit ??= canvasColor(ctx, color) ?? [255, 42, 42, 1];
        const from = emitterFor(frame.strokes, fontSize);
        const width = beam * fontSize;
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'lighter';
        for (const { head, id } of frame.active) {
          // The beam: a wide faint haze, the colored beam, a white core.
          for (const [w, style] of [
            [width * 5, rgba([...lit.slice(0, 3), 0.12] as Rgba)],
            [width * 2, rgba([...lit.slice(0, 3), 0.55] as Rgba)],
            [width * 0.6, 'rgba(255, 255, 255, 0.9)'],
          ] as const) {
            ctx.strokeStyle = style;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(head.x, head.y);
            ctx.stroke();
          }
          // The flare where it hits, pulsing.
          const pulse = 0.85 + 0.15 * Math.sin(frame.time * 60);
          const flare = fontSize * 0.09 * pulse;
          const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, flare);
          g.addColorStop(0, 'rgba(255, 255, 255, 1)');
          g.addColorStop(0.3, rgba([...lit.slice(0, 3), 0.8] as Rgba));
          g.addColorStop(1, rgba([...lit.slice(0, 3), 0] as Rgba));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(head.x, head.y, flare, 0, Math.PI * 2);
          ctx.fill();
          if (!sparks) continue;
          // Sparks: a handful of short streaks thrown off, new every 1/30 s.
          const random = seededRandom(Math.floor(frame.time * 30), `spark:${id}`);
          ctx.strokeStyle = rgba(mix(lit, [255, 255, 255, 1], 0.6));
          ctx.lineWidth = Math.max(1, width * 0.5);
          for (let i = 0; i < 6; i++) {
            const a = random() * Math.PI * 2;
            const r0 = fontSize * (0.02 + random() * 0.04);
            const r1 = r0 + fontSize * (0.03 + random() * 0.08);
            ctx.globalAlpha = 0.4 + random() * 0.6;
            ctx.beginPath();
            ctx.moveTo(head.x + Math.cos(a) * r0, head.y + Math.sin(a) * r0);
            ctx.lineTo(head.x + Math.cos(a) * r1, head.y + Math.sin(a) * r1 + fontSize * 0.02);
            ctx.stroke();
          }
        }
      },
    };
  },
});
