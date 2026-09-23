// Elliptic nibs — reaching small ears of ink without a detour.
//
// Spur pruning (graph.ts) removes offshoots whose ink lies near a node's
// inscribed disk: the point of a V, a pointed terminal, a bulge on a
// shoulder. A round pen centered on the node cannot reach that ink; a round
// pen made bigger bulges out past BOTH walls. An ellipse can point into the
// ear and stay as narrow as the ear is. A flick (an out-and-back excursion
// to the ear's tip) reaches the ink too, but draws as a jab.
//
// A nib is an elliptic STAMP the pen leaves as it passes the node (see
// `Nib`); the stroke path is unchanged. Per node with visible flicks, fit ONE
// ellipse:
//   - its major axis tilted near a flick's direction (±40°);
//   - anchored to the pen: its back edge on the node center or half a
//     radius behind it, so it reads as part of the stroke;
//   - its minor diameter up to the node's width, as narrow as the ear needs;
//   - the longest one whose outline stays inside the ink (no spill);
//   - chosen by how much of the node's pruned ink it paints.
// Flicks whose ink the ellipse mostly paints are dropped; the rest (ears
// too long or bent for one ellipse) stay as flicks.

import type { Nib, Point } from 'tegaki';
import { dist } from '../primitives.ts';
import type { AxisPoint } from '../types.ts';
import type { InkGraph } from './graph.ts';
import { trianglePoints } from './mesh.ts';

const TILTS_DEG = [0, -10, 10, -20, 20, -30, 30, -40, 40];
/** Minor semi-axis candidates, as fractions of the node radius. */
const MINOR_RATIOS = [1, 0.8, 0.6, 0.45, 0.3];
/** Back-edge anchor candidates: how far behind the node center, as fractions of the radius. */
const BACK_RATIOS = [0, 0.5];
const OUTLINE_SAMPLES = 48;
/** A flick survives a nib only when more than this share of its own ink is still unpainted. */
const FLICK_KEEP_SHARE = 0.3;

/** True when `p` lies inside the nib stamped at `at` (grown by `tolerance`). */
export function inNib(p: Point, at: Point, nib: Nib, tolerance = 0): boolean {
  const c = Math.cos(nib.angle);
  const s = Math.sin(nib.angle);
  const dx = p.x - at.x - nib.dx;
  const dy = p.y - at.y - nib.dy;
  const u = (dx * c + dy * s) / (nib.major / 2 + tolerance);
  const v = (-dx * s + dy * c) / (nib.minor / 2 + tolerance);
  return u * u + v * v <= 1;
}

/**
 * Fit nibs at every stroke-carrying node with visible flicks (hubs and
 * pruned-down ends; junction nodes are trimmed out of strokes, so skipped).
 * Sets `g.nibs[t]` (relative to the node center, where the stroke passes)
 * and drops the flicks each nib makes redundant. Returns the nib count.
 */
export function fitNibs(g: InkGraph, inkAt: (p: Point) => boolean, step: number, minPoke: number): number {
  let fitted = 0;
  for (let t = 0; t < g.mesh.triCount; t++) {
    if (!g.alive[t] || g.deg[t]! > 2 || g.radius[t]! <= 0) continue;
    const flicks = g.flicks[t]!.filter((f) => f.poke > minPoke);
    if (flicks.length === 0) continue;
    const c = g.center[t]!;
    const r = g.radius[t]!;

    // The node's pruned ink the round pen misses, as area-weighted centroids.
    const unpainted: { p: Point; area: number }[] = [];
    for (const tri of g.absorbed[t]!) {
      const [p0, p1, p2] = trianglePoints(g.mesh, tri);
      const p = { x: (p0.x + p1.x + p2.x) / 3, y: (p0.y + p1.y + p2.y) / 3 };
      if (dist(p, c) <= r) continue;
      unpainted.push({ p, area: Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x)) / 2 });
    }

    const fits = (nib: Nib) => {
      const cs = Math.cos(nib.angle);
      const sn = Math.sin(nib.angle);
      for (let k = 0; k < OUTLINE_SAMPLES; k++) {
        const phi = (k / OUTLINE_SAMPLES) * Math.PI * 2;
        const lx = (nib.major / 2) * Math.cos(phi);
        const ly = (nib.minor / 2) * Math.sin(phi);
        if (!inkAt({ x: c.x + nib.dx + lx * cs - ly * sn, y: c.y + nib.dy + lx * sn + ly * cs })) return false;
      }
      return true;
    };
    const gainOf = (nib: Nib) => {
      let gain = 0;
      for (const q of unpainted) if (inNib(q.p, c, nib)) gain += q.area;
      return gain;
    };

    let best: { nib: Nib; gain: number } | null = null;
    for (const flick of flicks) {
      const tip = flick.path[flick.path.length - 1]!;
      const d = dist(c, tip);
      if (d <= r) continue;
      const base = Math.atan2(tip.y - c.y, tip.x - c.x);
      for (const tilt of TILTS_DEG) {
        const angle = base + (tilt * Math.PI) / 180;
        const u = { x: Math.cos(angle), y: Math.sin(angle) };
        for (const back of BACK_RATIOS) {
          for (const minorRatio of MINOR_RATIOS) {
            const b = minorRatio * r;
            // Semi-major a, back edge pinned at c − back·r·u: center at c + (a − back·r)·u.
            const nibFor = (a: number): Nib => ({
              dx: u.x * (a - back * r),
              dy: u.y * (a - back * r),
              major: 2 * a,
              minor: 2 * b,
              angle,
            });
            // The front edge need not pass the tip.
            let lo = b;
            let hi = (d + back * r) / 2;
            if (hi <= lo || !fits(nibFor(lo))) continue;
            for (let it = 0; it < 10; it++) {
              const a = (lo + hi) / 2;
              if (fits(nibFor(a))) lo = a;
              else hi = a;
            }
            const nib = nibFor(lo);
            const gain = gainOf(nib);
            if (!best || gain > best.gain) best = { nib, gain };
          }
        }
      }
    }
    if (!best || best.gain < step * step) continue;
    const nib = best.nib;
    g.nibs[t] = nib;
    fitted++;

    // Drop the flicks the nib makes redundant: those whose OWN ink (pruned
    // ink the flick's pen sweeps) is mostly painted by the nib already. A
    // flick ends on the ear's deepest outline vertex — a sharp tip no
    // ellipse inside the ink reaches — so tip distance is the wrong test;
    // the ink left for the flick is the right one.
    g.flicks[t] = g.flicks[t]!.filter((f) => {
      if (f.poke <= minPoke) return true;
      const path = [{ ...c, width: 2 * r }, ...f.path];
      let own = 0;
      let left = 0;
      for (const q of unpainted) {
        let swept = false;
        for (let k = 1; k < path.length && !swept; k++) {
          swept = inCapsule(q.p, path[k - 1]!, path[k]!, Math.min(path[k - 1]!.width, path[k]!.width) / 2);
        }
        if (!swept) continue;
        own += q.area;
        if (!inNib(q.p, c, nib)) left += q.area;
      }
      return left > Math.max(FLICK_KEEP_SHARE * own, step * step);
    });
  }
  return fitted;
}

function inCapsule(p: Point, a: Point, b: Point, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= radius;
}

/**
 * Carry nibs from `before` onto re-shaped strokes `after` (reference
 * re-grouping splits, densifies and re-simplifies points, and would drop
 * them). A nib belongs to a place in the ink, not a point index: each moves
 * to the nearest spot on the new polylines — an existing point, or one
 * inserted there — with its ellipse kept exactly where it was.
 */
export function carryNibs<S extends { points: AxisPoint[] }>(before: S[], after: S[]): S[] {
  const nibs = before.flatMap((s) => s.points.filter((p) => p.nib));
  if (nibs.length === 0) return after;
  const out = after.map((s) => ({
    ...s,
    points: s.points.map(({ nib: _dropped, ...p }) => p as AxisPoint),
  }));
  for (const anchor of nibs) {
    let best = null as { stroke: number; seg: number; t: number; d: number } | null;
    for (let si = 0; si < out.length; si++) {
      const pts = out[si]!.points;
      for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
        const a = pts[i]!;
        const b = pts[Math.min(i + 1, pts.length - 1)]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / l2)) : 0;
        const d = Math.hypot(a.x + dx * t - anchor.x, a.y + dy * t - anchor.y);
        if (!best || d < best.d) best = { stroke: si, seg: i, t, d };
      }
    }
    if (!best || best.d > anchor.width / 2) continue;
    const { stroke, seg, t } = best;
    const pts = out[stroke]!.points;
    const a = pts[seg]!;
    const b = pts[Math.min(seg + 1, pts.length - 1)]!;
    // Snap to an endpoint within a hair; otherwise insert a point.
    const tol = 1e-3;
    let idx: number;
    if (t <= tol || dist(a, b) * t < 0.5) idx = seg;
    else if (t >= 1 - tol || dist(a, b) * (1 - t) < 0.5) idx = Math.min(seg + 1, pts.length - 1);
    else {
      pts.splice(seg + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: a.width + (b.width - a.width) * t });
      idx = seg + 1;
    }
    const q = pts[idx]!;
    if (q.nib) continue; // one stamp per point
    const nib = anchor.nib!;
    q.nib = { ...nib, dx: anchor.x + nib.dx - q.x, dy: anchor.y + nib.dy - q.y };
  }
  return out;
}
