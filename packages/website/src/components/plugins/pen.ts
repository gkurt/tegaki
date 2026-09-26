import { expandBox, type StrokeFrame, type TegakiFrame, type TegakiPlugin, unionBoxes } from 'tegaki/core';

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

/**
 * A fountain pen writing the text: its nib on the head of each stroke being
 * drawn, held at a slant that sways a little with the direction of the ink,
 * and lifted between strokes. An `overlay`, so clip-to-text doesn't cut it;
 * `bounds` makes room for its length above the ink.
 */
export function penPlugin(): TegakiPlugin {
  return {
    name: 'pen',
    bounds: ({ strokes, fontSize }) => expandBox(unionBoxes(strokes.map((s) => s.path.bounds())), fontSize * 1.2),
    overlay: ({ ctx, frame, fontSize }) => {
      for (const pose of penPoses(frame)) drawPen(ctx, pose, fontSize);
    },
  };
}

/** How far the tip rises off the paper when fully lifted, in ems. */
const LIFT_EM = 0.16;
/** The pen's slant: its body runs up and to the right of the tip. */
const SLANT = -1.02;

function drawPen(ctx: CanvasRenderingContext2D, pose: PenPose, fontSize: number) {
  const L = fontSize;
  const rise = pose.lift * LIFT_EM * fontSize;
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
  ctx.fillStyle = '#14286b';
  penOutline(ctx, L);
  ctx.fill();
  ctx.restore();

  // Barrel and cap end, shaded like a cylinder (light on its upper side).
  const barrel = ctx.createLinearGradient(0, -0.055 * L, 0, 0.055 * L);
  barrel.addColorStop(0, '#5a79d6');
  barrel.addColorStop(0.35, '#2b4bb0');
  barrel.addColorStop(1, '#14286b');
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

  ctx.restore();
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
