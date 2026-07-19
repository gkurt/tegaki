import { beforeAll, describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { initStraightSkeleton, straightSkeletonFaceAxes, straightSkeletonStrokeAxis } from './face-straight-skeleton.ts';
import { clampWidthsToBoundary, computeSegmentAxes } from './medial.ts';
import { dist, signedArea } from './primitives.ts';
import { type AxisPoint, DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions, type SegmentInfo } from './types.ts';

const OPTIONS = resolveGeometryOptions({ ...DEFAULT_GEOMETRY_OPTIONS, medialMethod: 'straight-skeleton' }, 1000);

beforeAll(async () => {
  await initStraightSkeleton();
});

/** Build a segment Face, reorienting to region-on-left and remapping edge tags. */
function buildFace(points: Point[], edgeCutIds: number[]): Face {
  let polygon = points;
  let tags = edgeCutIds;
  if (signedArea(points) < 0) {
    const n = points.length;
    polygon = [...points].reverse();
    tags = polygon.map((_, j) => edgeCutIds[(n - 2 - j + n) % n]!);
  }
  const c = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return {
    id: 0,
    polygon,
    edgeCutIds: tags,
    holes: [],
    cutIds: [...new Set(tags.filter((t) => t >= 0))],
    area: Math.abs(signedArea(points)),
    centroid: { x: c.x / polygon.length, y: c.y / polygon.length },
    kind: 'segment',
  };
}

/** How far p sticks out of the pen's reach along the axes' segments (lerped widths). */
function penGap(infos: SegmentInfo[], p: Point): number {
  let best = Infinity;
  for (const s of infos) {
    for (let i = 1; i < s.axis.length; i++) {
      const a = s.axis[i - 1]!;
      const b = s.axis[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const w = a.width + (b.width - a.width) * t;
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) - w / 2);
    }
  }
  return best;
}

function axesOf(face: Face): SegmentInfo[] | null {
  const infos = straightSkeletonFaceAxes(face, OPTIONS);
  if (infos) for (const info of infos) clampWidthsToBoundary(info.axis, face);
  return infos;
}

describe('straightSkeletonFaceAxes', () => {
  // A 400×60 corridor with a cut at each end: the exact skeleton spine is the
  // horizontal centerline at width 60, ports extend it to the cut midpoints.
  const corridor = () =>
    buildFace(
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 60 },
        { x: 0, y: 60 },
      ],
      [-1, 0, -1, 1],
    );

  test('straight corridor: centered spine at the exact corridor width, port to port', () => {
    const infos = axesOf(corridor());
    expect(infos).not.toBeNull();
    expect(infos!.length).toBe(1);
    const axis = infos![0]!.axis;
    // Spans the cut midpoints exactly (port order is not guaranteed).
    const endpoints = [axis[0]!, axis[axis.length - 1]!];
    for (const mouth of [
      { x: 0, y: 30 },
      { x: 400, y: 30 },
    ]) {
      expect(Math.min(...endpoints.map((e) => dist(e, mouth)))).toBeLessThan(1);
    }
    for (const p of axis) {
      expect(Math.abs(p.y - 30)).toBeLessThan(1); // centered
      expect(p.width).toBeGreaterThan(50); // ~60 in the interior, ≥ port cap at the mouths
      expect(p.width).toBeLessThanOrEqual(61);
    }
    expect(infos![0]!.ends.map((e) => e.cutId).sort()).toEqual([0, 1]);
  });

  test('input orientation is normalized (the wasm module aborts on CW rings — the wrapper must not)', () => {
    const face = corridor();
    // Force the polygon the OTHER way round; straightSkeletonFaceAxes must
    // still build (it reverses to CCW itself) instead of aborting the wasm
    // runtime.
    const n = face.polygon.length;
    const reversed: Face = {
      ...face,
      polygon: [...face.polygon].reverse(),
      edgeCutIds: face.polygon.map((_, j) => face.edgeCutIds[(n - 2 - j + n) % n]!),
    };
    const infos = straightSkeletonFaceAxes(reversed, OPTIONS);
    expect(infos).not.toBeNull();
    expect(infos!.length).toBe(1);
  });

  test('curved corridor: pen coverage along the analytic centerline', () => {
    // Quarter-arc corridor, radius 200, width 60.
    const outer: Point[] = [];
    const inner: Point[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const a = (Math.PI / 2) * (i / N);
      outer.push({ x: 230 * Math.cos(a), y: 230 * Math.sin(a) });
      inner.push({ x: 170 * Math.cos(a), y: 170 * Math.sin(a) });
    }
    const pts = [...outer, ...[...inner].reverse()];
    const tags = pts.map((_, i) => (i === N ? 0 : i === pts.length - 1 ? 1 : -1));
    const infos = axesOf(buildFace(pts, tags));
    expect(infos).not.toBeNull();
    for (let i = 0; i <= 20; i++) {
      const a = (Math.PI / 2) * (i / 20);
      const c = { x: 200 * Math.cos(a), y: 200 * Math.sin(a) };
      expect(penGap(infos!, c)).toBeLessThan(2);
    }
  });

  test('degenerate (slit) polygon returns null and computeSegmentAxes falls back to chain', () => {
    // A rectangle with a zero-width slit — weakly simple, CGAL rejects it.
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 20 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
    ];
    const face = buildFace(
      pts,
      pts.map(() => -1),
    );
    expect(straightSkeletonFaceAxes(face, OPTIONS)).toBeNull();
    const fallback = computeSegmentAxes(face, OPTIONS);
    expect(fallback.length).toBeGreaterThan(0);
  });

  test('stroke axis through a merged T junction runs straight, stem limb suppressed by other ink', () => {
    // The T's bar region MERGED with the kernel: one 600×80 rectangle whose
    // bottom edge carries the stem-mouth cut in the middle. The old per-face
    // pipeline stitched bar-left + route-through-kernel + bar-right and
    // jogged at the mouths; the merged skeleton must run straight through.
    const face = buildFace(
      [
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 80 },
        { x: 340, y: 80 },
        { x: 260, y: 80 },
        { x: 0, y: 80 },
      ],
      [-1, -1, -1, 9, -1, -1],
    );
    // The stem stroke's pen already sweeps below the mouth and into it.
    const stemInk = Array.from({ length: 8 }, (_, i) => ({ x: 300, y: 80 + i * 30, radius: 45 }));
    const axis = straightSkeletonStrokeAxis(face, OPTIONS, { x: 5, y: 40, width: 78 }, { x: 595, y: 40, width: 78 }, stemInk);
    expect(axis).not.toBeNull();
    // Straight-ish: every point near the centerline, no jog into the mouth.
    for (const p of axis!) {
      expect(Math.abs(p.y - 40)).toBeLessThan(6);
    }
    // Monotone in x — a zigzag or a retraced limb into the stem would double back.
    for (let i = 1; i < axis!.length; i++) {
      expect(axis![i]!.x).toBeGreaterThanOrEqual(axis![i - 1]!.x - 1e-6);
    }
  });

  test('annulus face: the skeleton cycle becomes one closed loop axis', () => {
    // Square ring: outer 0..300, counter 100..200 — corridor width 100. The
    // skeleton spine is a cycle; the loop walk must return it as a single
    // CLOSED axis riding the corridor midline all the way around.
    const face = buildFace(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 0, y: 300 },
      ],
      [-1, -1, -1, -1],
    );
    face.holes = [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    ];
    const infos = straightSkeletonFaceAxes(face, OPTIONS);
    expect(infos).not.toBeNull();
    expect(infos!.length).toBe(1);
    const { axis, isLoop } = infos![0]!;
    expect(isLoop).toBe(true);
    const first = axis[0]!;
    const last = axis[axis.length - 1]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1e-6);
    // The ring visits all four sides of the corridor.
    const xs = axis.map((p) => p.x);
    const ys = axis.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(100);
    expect(Math.max(...xs)).toBeGreaterThan(200);
    expect(Math.min(...ys)).toBeLessThan(100);
    expect(Math.max(...ys)).toBeGreaterThan(200);
    // Widths are the corridor's inscribed diameter (100), not the raw
    // skeleton time near corner diagonals.
    for (const p of axis) {
      expect(p.width).toBeGreaterThan(60);
      expect(p.width).toBeLessThanOrEqual(101);
    }
  });

  test('anchored stroke over a loop-with-tail region walks the FULL ring before exiting', () => {
    // An `a`/`0`-class region: square ring plus a tail hanging off the
    // bottom-right. A shortest-path primary between the anchors would cut
    // across one arc and drop the rest of the bowl — the cycle walk must
    // visit all four corridor sides, then leave along the tail.
    const face = buildFace(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 260, y: 300 },
        { x: 260, y: 420 },
        { x: 200, y: 420 },
        { x: 200, y: 300 },
        { x: 0, y: 300 },
      ],
      [-1, -1, -1, -1, -1, -1, -1, -1],
    );
    face.holes = [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    ];
    const axis = straightSkeletonStrokeAxis(face, OPTIONS, { x: 250, y: 250, width: 100 }, { x: 230, y: 410, width: 50 }, []);
    expect(axis).not.toBeNull();
    const xs = axis!.map((p) => p.x);
    const ys = axis!.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(100); // left corridor visited
    expect(Math.min(...ys)).toBeLessThan(100); // top corridor visited
    const last = axis![axis!.length - 1]!;
    expect(last.y).toBeGreaterThan(400); // exits at the tail tip
    // No segment may cross the counter — tip extensions must stop at hole
    // boundaries (Caveat 0 once drew a 380-unit chord through its counter).
    for (let i = 1; i < axis!.length; i++) {
      const a = axis![i - 1]!;
      const b = axis![i]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const inHole = mid.x > 100 && mid.x < 200 && mid.y > 100 && mid.y < 200;
      expect(inHole).toBe(false);
    }
  });

  test("quarter-integer lattice bar tip builds instead of exploding CGAL (Caveat '#' face8)", () => {
    // Verbatim crop from Caveat '#' (Fontsource build): a perfectly simple
    // 49-vertex diagonal bar tip whose grid-aligned coordinates produced
    // exactly-degenerate CGAL events — the wasm ground for ~3s while its
    // memory climbed toward 3 GB, then threw (the browser froze). The
    // deterministic input jitter must make this build succeed, fast.
    const P: Point[] = [
      { x: 509.0, y: -440.0 },
      { x: 516.25, y: -457.75 },
      { x: 524.0, y: -477.0 },
      { x: 540.25, y: -518.875 },
      { x: 557.0, y: -562.5 },
      { x: 573.5, y: -605.875 },
      { x: 589.0, y: -647.0 },
      { x: 596.125, y: -666.125 },
      { x: 602.5, y: -683.5 },
      { x: 608.125, y: -699.125 },
      { x: 613.0, y: -713.0 },
      { x: 616.9375, y: -724.625 },
      { x: 619.75, y: -733.5 },
      { x: 621.4375, y: -739.625 },
      { x: 622.0, y: -743.0 },
      { x: 623.0, y: -750.0 },
      { x: 626.0, y: -755.0 },
      { x: 631.0, y: -758.0 },
      { x: 638.0, y: -759.0 },
      { x: 641.375, y: -761.5 },
      { x: 645.5, y: -763.0 },
      { x: 654.0, y: -764.0 },
      { x: 670.0, y: -748.0 },
      { x: 676.375, y: -740.5 },
      { x: 679.5, y: -732.0 },
      { x: 680.625, y: -722.25 },
      { x: 681.0, y: -711.0 },
      { x: 680.25, y: -698.75 },
      { x: 678.0, y: -688.0 },
      { x: 676.125, y: -682.4375 },
      { x: 673.5, y: -675.75 },
      { x: 670.125, y: -667.9375 },
      { x: 666.0, y: -659.0 },
      { x: 660.875, y: -648.1875 },
      { x: 654.5, y: -634.75 },
      { x: 646.875, y: -618.6875 },
      { x: 638.0, y: -600.0 },
      { x: 636.125, y: -595.25 },
      { x: 633.5, y: -589.0 },
      { x: 630.125, y: -581.25 },
      { x: 626.0, y: -572.0 },
      { x: 616.625, y: -550.75 },
      { x: 606.5, y: -527.0 },
      { x: 596.125, y: -502.5 },
      { x: 586.0, y: -479.0 },
      { x: 580.8125, y: -467.9375 },
      { x: 576.25, y: -457.75 },
      { x: 572.3125, y: -448.4375 },
      { x: 569.0, y: -440.0 },
    ];
    const face = buildFace(
      P,
      P.map((_, i) => (i === P.length - 1 ? 2 : -1)),
    );
    const t0 = performance.now();
    const infos = straightSkeletonFaceAxes(face, OPTIONS);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(infos).not.toBeNull();
    expect(infos!.length).toBeGreaterThanOrEqual(1);
    expect(infos![0]!.axis.length).toBeGreaterThanOrEqual(2);
  });

  test('tapered ribbon: widths follow the taper', () => {
    // 300-long wedge from width 80 down to width 20, cut at the wide end.
    const face = buildFace(
      [
        { x: 0, y: -40 },
        { x: 300, y: -10 },
        { x: 300, y: 10 },
        { x: 0, y: 40 },
      ],
      [-1, -1, -1, 0],
    );
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    const axis = infos![0]!.axis;
    const widthNear = (x: number): number => {
      let best: AxisPoint = axis[0]!;
      for (const p of axis) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      return best.width;
    };
    expect(widthNear(30)).toBeGreaterThan(60);
    expect(widthNear(270)).toBeLessThan(40);
  });
});
