import { createPlugin, expandBox, type StrokeFrame, type TegakiFrame, unionBoxes } from 'tegaki/core';

/** Where a pen is: its tip, the way the ink under it runs, and how far off the paper it's lifted (0 on it, 1 fully up). */
export interface PenPose {
  x: number;
  y: number;
  angle: number;
  lift: number;
}

/** Seconds the pen takes to come off the paper once the last stroke is done. */
const LIFT_TIME = 0.25;

const smooth = (f: number) => f * f * (3 - 2 * f);

/**
 * Where the pens are at a frame. One on each stroke being drawn; between
 * strokes, one pen travels from the end of the last stroke to the start of
 * the next, lifting off the paper on the way. Before the first stroke it
 * hovers over its start, and after the last it lifts off its end.
 */
export function penPoses(frame: TegakiFrame): PenPose[] {
  if (frame.active.length > 0) return frame.active.map(({ head }) => ({ x: head.x, y: head.y, angle: head.angle, lift: 0 }));
  let prev: StrokeFrame | undefined;
  let next: StrokeFrame | undefined;
  for (const s of frame.strokes) {
    if (s.state === 'done' && (!prev || s.start + s.duration >= prev.start + prev.duration)) prev = s;
    if (s.state === 'pending' && (!next || s.start < next.start)) next = s;
  }
  const from = prev?.path.pointAt(1);
  const to = next?.path.pointAt(0);
  if (prev && next && from && to) {
    const t0 = prev.start + prev.duration;
    const span = next.start - t0;
    const f = span > 0 ? smooth(Math.max(0, Math.min(1, (frame.time - t0) / span))) : 1;
    return [{ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, angle: to.angle, lift: Math.sin(Math.PI * f) }];
  }
  if (prev && from) {
    const f = Math.max(0, Math.min(1, (frame.time - prev.start - prev.duration) / LIFT_TIME));
    return [{ x: from.x, y: from.y, angle: from.angle, lift: smooth(f) }];
  }
  if (to) return [{ x: to.x, y: to.y, angle: to.angle, lift: 1 }];
  return [];
}

/** Barrel shades, light side to dark, per finish. */
const BARRELS = {
  blue: ['#5a79d6', '#2b4bb0', '#14286b'],
  black: ['#5c5c66', '#26262c', '#0d0d10'],
  burgundy: ['#b0506a', '#7a1f3a', '#420d1f'],
  green: ['#4f9c7a', '#1f6b4c', '#0c3a27'],
} as const;

export type PenBarrel = keyof typeof BARRELS;

export type PenTool = 'fountain' | 'pencil' | 'quill';

/** How the pen looks: which it is, its length in ems, its finish (a fountain pen's), and how high it lifts between strokes, in ems. */
export interface PenStyle {
  tool: PenTool;
  size: number;
  barrel: PenBarrel;
  lift: number;
}

/**
 * A fountain pen writing the text: its nib on the head of each stroke being
 * drawn, held at a slant that sways a little with the direction of the ink,
 * and lifted between strokes. An `overlay`, so clip-to-text doesn't cut it;
 * `bounds` makes room for its length above the ink.
 */
export const penPlugin = createPlugin({
  name: 'pen',
  label: 'Pen',
  description: 'A fountain pen, a pencil or a quill writes the text, lifting between strokes. overlay + bounds.',
  params: {
    tool: {
      type: 'select',
      label: 'Tool',
      default: 'fountain',
      options: [
        { value: 'fountain', label: 'Fountain pen' },
        { value: 'pencil', label: 'Pencil' },
        { value: 'quill', label: 'Quill' },
      ],
    },
    size: { type: 'number', label: 'Size', default: 1, min: 0.5, max: 2, step: 0.1 },
    barrel: {
      type: 'select',
      label: 'Barrel',
      default: 'blue',
      options: [
        { value: 'blue', label: 'Blue' },
        { value: 'black', label: 'Black' },
        { value: 'burgundy', label: 'Burgundy' },
        { value: 'green', label: 'Green' },
      ],
    },
    lift: { type: 'number', label: 'Lift', default: 0.16, min: 0, max: 0.5, step: 0.02 },
  },
  presets: {
    Pencil: { tool: 'pencil', lift: 0.1 },
    Quill: { tool: 'quill', size: 1.4, lift: 0.22 },
  },
  setup: (style) => ({
    bounds: ({ strokes, fontSize }) =>
      expandBox(
        unionBoxes(strokes.map((s) => s.path.bounds())),
        fontSize * (0.2 + style.size * (style.tool === 'quill' ? 1.25 : 1) + style.lift),
      ),
    overlay: ({ ctx, frame, fontSize }) => {
      for (const pose of penPoses(frame)) drawPen(ctx, pose, fontSize, style);
    },
  }),
});

/** The pen's slant: its body runs up and to the right of the tip. */
const SLANT = -1.02;

function drawPen(ctx: CanvasRenderingContext2D, pose: PenPose, fontSize: number, style: PenStyle) {
  const L = fontSize * style.size;
  const [light, mid, dark] = BARRELS[style.barrel];
  const rise = pose.lift * style.lift * fontSize;
  const angle = SLANT + 0.12 * Math.sin(pose.angle);

  ctx.save();
  ctx.translate(pose.x, pose.y - rise);
  ctx.rotate(angle);

  // The silhouette casts a soft shadow on the paper — close under the pen
  // while it writes, falling farther away as it lifts.
  ctx.save();
  // Shadow sizes are in device px, which the canvas transform doesn't scale.
  const m = ctx.getTransform();
  const px = Math.hypot(m.a, m.b);
  ctx.shadowColor = `rgba(0, 0, 0, ${0.22 - 0.08 * pose.lift})`;
  ctx.shadowBlur = (0.03 + 0.05 * pose.lift) * L * px;
  ctx.shadowOffsetX = (0.02 * L + rise * 0.7) * px;
  ctx.shadowOffsetY = (0.03 * L + rise) * px;
  ctx.fillStyle = dark;
  if (style.tool === 'pencil') pencilOutline(ctx, L);
  else if (style.tool === 'quill') quillOutline(ctx, L);
  else penOutline(ctx, L);
  ctx.fill();
  ctx.restore();

  if (style.tool === 'pencil') drawPencil(ctx, L);
  else if (style.tool === 'quill') drawQuill(ctx, L);
  else drawFountainPen(ctx, L, light, mid, dark);
  ctx.restore();
}

function drawFountainPen(ctx: CanvasRenderingContext2D, L: number, light: string, mid: string, dark: string) {
  // Barrel and cap end, shaded like a cylinder (light on its upper side).
  const barrel = ctx.createLinearGradient(0, -0.055 * L, 0, 0.055 * L);
  barrel.addColorStop(0, light);
  barrel.addColorStop(0.35, mid);
  barrel.addColorStop(1, dark);
  ctx.fillStyle = barrel;
  ctx.beginPath();
  ctx.moveTo(0.33 * L, -0.052 * L);
  ctx.lineTo(0.93 * L, -0.05 * L);
  ctx.arc(0.93 * L, 0, 0.05 * L, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(0.33 * L, 0.052 * L);
  ctx.closePath();
  ctx.fill();

  // Grip.
  const grip = ctx.createLinearGradient(0, -0.045 * L, 0, 0.045 * L);
  grip.addColorStop(0, '#55555e');
  grip.addColorStop(0.4, '#26262c');
  grip.addColorStop(1, '#0d0d10');
  ctx.fillStyle = grip;
  ctx.beginPath();
  ctx.moveTo(0.15 * L, -0.034 * L);
  ctx.lineTo(0.34 * L, -0.046 * L);
  ctx.lineTo(0.34 * L, 0.046 * L);
  ctx.lineTo(0.15 * L, 0.034 * L);
  ctx.closePath();
  ctx.fill();

  // Gold band where the barrel meets the grip.
  ctx.fillStyle = '#c9a44c';
  ctx.fillRect(0.33 * L, -0.053 * L, 0.025 * L, 0.106 * L);

  // Nib: a steel point with its slit and breather hole.
  const nib = ctx.createLinearGradient(0, -0.03 * L, 0, 0.03 * L);
  nib.addColorStop(0, '#f4f4f6');
  nib.addColorStop(0.5, '#b9b9c1');
  nib.addColorStop(1, '#7c7c86');
  ctx.fillStyle = nib;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0.08 * L, -0.012 * L, 0.16 * L, -0.032 * L);
  ctx.lineTo(0.16 * L, 0.032 * L);
  ctx.quadraticCurveTo(0.08 * L, 0.012 * L, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 40, 48, 0.8)';
  ctx.lineWidth = Math.max(0.6, 0.006 * L);
  ctx.beginPath();
  ctx.moveTo(0.005 * L, 0);
  ctx.lineTo(0.1 * L, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(40, 40, 48, 0.8)';
  ctx.beginPath();
  ctx.arc(0.105 * L, 0, 0.008 * L, 0, Math.PI * 2);
  ctx.fill();
}

/** The pen's silhouette, tip at the origin, running along +x. */
function penOutline(ctx: CanvasRenderingContext2D, L: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.16 * L, -0.034 * L);
  ctx.lineTo(0.34 * L, -0.052 * L);
  ctx.lineTo(0.93 * L, -0.05 * L);
  ctx.arc(0.93 * L, 0, 0.05 * L, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(0.34 * L, 0.052 * L);
  ctx.lineTo(0.16 * L, 0.034 * L);
  ctx.closePath();
}

/** A pencil's silhouette: graphite point, sharpened wood, hexagonal body, ferrule and eraser. */
function pencilOutline(ctx: CanvasRenderingContext2D, L: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.16 * L, -0.045 * L);
  ctx.lineTo(0.95 * L, -0.045 * L);
  ctx.arc(0.95 * L, 0, 0.045 * L, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(0.16 * L, 0.045 * L);
  ctx.closePath();
}

function drawPencil(ctx: CanvasRenderingContext2D, L: number) {
  const w = 0.045 * L;
  // Body: three faces of the hexagon, lit from above.
  const faces = ['#ffd95a', '#f2b705', '#b98300'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = faces[i]!;
    ctx.fillRect(0.16 * L, -w + (i * 2 * w) / 3, 0.7 * L, (2 * w) / 3 + 0.5);
  }
  // Sharpened wood, scalloped where the blade cut it.
  const wood = ctx.createLinearGradient(0, -w, 0, w);
  wood.addColorStop(0, '#f6dfbd');
  wood.addColorStop(1, '#c79a64');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(0.035 * L, -0.01 * L);
  ctx.lineTo(0.16 * L, -w);
  ctx.quadraticCurveTo(0.14 * L, 0, 0.16 * L, w);
  ctx.lineTo(0.035 * L, 0.01 * L);
  ctx.closePath();
  ctx.fill();
  // Graphite point.
  ctx.fillStyle = '#3a3a40';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.04 * L, -0.0115 * L);
  ctx.lineTo(0.04 * L, 0.0115 * L);
  ctx.closePath();
  ctx.fill();
  // Ferrule: ridged metal.
  const metal = ctx.createLinearGradient(0, -w, 0, w);
  metal.addColorStop(0, '#f0f0f2');
  metal.addColorStop(0.4, '#a9a9b2');
  metal.addColorStop(1, '#6d6d76');
  ctx.fillStyle = metal;
  ctx.fillRect(0.86 * L, -w * 1.04, 0.07 * L, w * 2.08);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let i = 1; i < 4; i++) ctx.fillRect(0.86 * L + i * 0.0175 * L, -w * 1.04, 0.003 * L, w * 2.08);
  // Eraser.
  ctx.fillStyle = '#ef8f9c';
  ctx.beginPath();
  ctx.moveTo(0.93 * L, -w);
  ctx.lineTo(0.95 * L, -w);
  ctx.arc(0.95 * L, 0, w, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(0.93 * L, w);
  ctx.closePath();
  ctx.fill();
}

/** Where a quill's vane runs along its shaft, and how far it reaches either side. */
function vane(t: number, L: number): { x: number; up: number; down: number } {
  const x = (0.3 + 0.95 * t) * L;
  const swell = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7;
  return { x, up: 0.13 * L * swell, down: 0.06 * L * swell * (1 - 0.3 * t) };
}

/** A quill's silhouette: the cut nib, the shaft, and the feather's vane. */
function quillOutline(ctx: CanvasRenderingContext2D, L: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.3 * L, -0.008 * L);
  for (let i = 0; i <= 20; i++) {
    const v = vane(i / 20, L);
    ctx.lineTo(v.x, -v.up);
  }
  for (let i = 20; i >= 0; i--) {
    const v = vane(i / 20, L);
    ctx.lineTo(v.x, v.down);
  }
  ctx.lineTo(0.3 * L, 0.008 * L);
  ctx.closePath();
}

function drawQuill(ctx: CanvasRenderingContext2D, L: number) {
  // The vane: pale, darker toward its edges and its tip.
  const feather = ctx.createLinearGradient(0.3 * L, 0, 1.25 * L, 0);
  feather.addColorStop(0, '#fbf8f1');
  feather.addColorStop(0.7, '#e7e0d2');
  feather.addColorStop(1, '#b9ad98');
  ctx.fillStyle = feather;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const v = vane(i / 20, L);
    ctx.lineTo(v.x, -v.up);
  }
  for (let i = 20; i >= 0; i--) {
    const v = vane(i / 20, L);
    ctx.lineTo(v.x, v.down);
  }
  ctx.closePath();
  ctx.fill();
  // Barbs, raked back toward the tip, and a split or two where they part.
  ctx.strokeStyle = 'rgba(120, 105, 85, 0.35)';
  ctx.lineWidth = Math.max(0.5, 0.004 * L);
  ctx.beginPath();
  for (let i = 1; i < 26; i++) {
    const t = i / 26;
    const v = vane(t, L);
    ctx.moveTo(v.x - 0.04 * L, 0);
    ctx.lineTo(v.x + 0.02 * L, -v.up * 0.97);
    ctx.moveTo(v.x - 0.03 * L, 0);
    ctx.lineTo(v.x + 0.015 * L, v.down * 0.95);
  }
  ctx.stroke();
  // Shaft, and the nib cut from it.
  ctx.strokeStyle = '#d8ccb1';
  ctx.lineWidth = Math.max(1, 0.012 * L);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0.02 * L, 0);
  ctx.quadraticCurveTo(0.7 * L, -0.012 * L, 1.24 * L, -0.03 * L);
  ctx.stroke();
  ctx.fillStyle = '#2b2118';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.06 * L, -0.006 * L);
  ctx.lineTo(0.06 * L, 0.006 * L);
  ctx.closePath();
  ctx.fill();
}
