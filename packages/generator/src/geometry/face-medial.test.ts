import { describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { medialFaceAxes } from './face-medial.ts';
import { clampWidthsToBoundary, computeSegmentAxes } from './medial.ts';
import { add, closestPointOnPolyline, dist, normalize, pointInPolygon, resamplePolyline, scale, signedArea, sub } from './primitives.ts';
import { type AxisPoint, DEFAULT_GEOMETRY_OPTIONS, type Face, resolveGeometryOptions, type SegmentInfo } from './types.ts';

const OPTIONS = resolveGeometryOptions(DEFAULT_GEOMETRY_OPTIONS, 1000); // spacing 20, boundary sample step 10
const OPTIONS_VORONOI = resolveGeometryOptions({ ...DEFAULT_GEOMETRY_OPTIONS, medialMethod: 'voronoi' }, 1000);

// ── Face construction ──────────────────────────────────────────────────────

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

interface EndSpec {
  kind: 'cut' | 'flat' | 'round';
  cutId?: number;
}

function capPoints(center: Point, from: Point, outward: Point, spec: EndSpec): Point[] {
  if (spec.kind !== 'round') return [from];
  const r = dist(center, from);
  const u = normalize(sub(from, center));
  const out = [from];
  const segs = Math.max(4, Math.min(12, Math.round(r / 4)));
  for (let k = 1; k < segs; k++) {
    const phi = (Math.PI * k) / segs;
    out.push({
      x: center.x + r * (u.x * Math.cos(phi) + outward.x * Math.sin(phi)),
      y: center.y + r * (u.y * Math.cos(phi) + outward.y * Math.sin(phi)),
    });
  }
  return out;
}

/**
 * Build a ribbon face by offsetting a centerline: the exact medial axis of the
 * result IS the centerline (with width 2×halfWidth), giving every test an
 * analytic ground truth. Ends are flat cuts, flat free caps, or round caps.
 */
function ribbonFace(centerline: Point[], halfWidth: (t: number) => number, start: EndSpec, end: EndSpec): Face {
  const n = 48;
  const c = resamplePolyline(centerline, n);
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + dist(c[i - 1]!, c[i]!));
  const total = cum[n - 1]!;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = normalize(sub(c[Math.min(n - 1, i + 1)]!, c[Math.max(0, i - 1)]!));
    const normal = { x: -t.y, y: t.x };
    const hw = halfWidth(cum[i]! / total);
    left.push(add(c[i]!, scale(normal, hw)));
    right.push(add(c[i]!, scale(normal, -hw)));
  }
  const pts: Point[] = [];
  const tags: number[] = [];
  const emit = (p: Point, tag: number) => {
    pts.push(p);
    tags.push(tag);
  };
  for (let i = 0; i < n - 1; i++) emit(left[i]!, -1);
  const endTag = end.kind === 'cut' ? (end.cutId ?? 0) : -1;
  for (const p of capPoints(c[n - 1]!, left[n - 1]!, normalize(sub(c[n - 1]!, c[n - 2]!)), end)) emit(p, endTag);
  for (let i = n - 1; i >= 1; i--) emit(right[i]!, -1);
  const startTag = start.kind === 'cut' ? (start.cutId ?? 1) : -1;
  for (const p of capPoints(c[0]!, right[0]!, normalize(sub(c[0]!, c[1]!)), start)) emit(p, startTag);
  return buildFace(pts, tags);
}

// ── Assertions ─────────────────────────────────────────────────────────────

/** medialFaceAxes + the boundary width clamp the pipeline always applies. */
function axesOf(face: Face): SegmentInfo[] | null {
  const infos = medialFaceAxes(face, OPTIONS);
  if (infos) for (const info of infos) clampWidthsToBoundary(info.axis, face);
  return infos;
}

const allPoints = (infos: SegmentInfo[]): AxisPoint[] => infos.flatMap((s) => s.axis);

/** Distance from p to the nearest axis point across all axes. */
function nearestD(infos: SegmentInfo[], p: Point): number {
  let best = Infinity;
  for (const a of allPoints(infos)) best = Math.min(best, dist(a, p));
  return best;
}

/** How far p sticks out of the pen's reach: min over axis points of (dist − width/2). */
function penGap(infos: SegmentInfo[], p: Point): number {
  let best = Infinity;
  for (const a of allPoints(infos)) best = Math.min(best, dist(a, p) - a.width / 2);
  return best;
}

/** Every centerline sample must be covered by the pen (dist ≤ width/2 + slack). */
function coverageViolations(infos: SegmentInfo[], centerline: Point[], slack: number): string[] {
  const out: string[] = [];
  const samples = resamplePolyline(centerline, 48);
  for (let i = 0; i < samples.length; i++) {
    const gap = penGap(infos, samples[i]!);
    if (gap > slack) out.push(`t=${(i / 47).toFixed(2)} gap=${gap.toFixed(1)}`);
  }
  return out;
}

/** Interior centerline samples must have an axis point nearby (no wobble/detour). */
function positionViolations(infos: SegmentInfo[], centerline: Point[], tol: number, tRange: [number, number] = [0.05, 0.95]): string[] {
  const out: string[] = [];
  const samples = resamplePolyline(centerline, 48);
  for (let i = 0; i < samples.length; i++) {
    const t = i / 47;
    if (t < tRange[0] || t > tRange[1]) continue;
    const d = nearestD(infos, samples[i]!);
    if (d > tol) out.push(`t=${t.toFixed(2)} d=${d.toFixed(1)}`);
  }
  return out;
}

/** The axis width near each interior centerline sample must match 2×halfWidth. */
function widthViolations(
  infos: SegmentInfo[],
  centerline: Point[],
  halfWidth: (t: number) => number,
  relTol: number,
  absTol: number,
  tRange: [number, number] = [0.08, 0.92],
): string[] {
  const out: string[] = [];
  const samples = resamplePolyline(centerline, 48);
  const pts = allPoints(infos);
  for (let i = 0; i < samples.length; i++) {
    const t = i / 47;
    if (t < tRange[0] || t > tRange[1]) continue;
    let nearest: AxisPoint | null = null;
    let bestD = Infinity;
    for (const a of pts) {
      const d = dist(a, samples[i]!);
      if (d < bestD) {
        bestD = d;
        nearest = a;
      }
    }
    const want = 2 * halfWidth(t);
    if (nearest && Math.abs(nearest.width - want) > Math.max(relTol * want, absTol)) {
      out.push(`t=${t.toFixed(2)} want=${want.toFixed(1)} got=${nearest.width.toFixed(1)}`);
    }
  }
  return out;
}

/** 0 when p is inside the face, otherwise its distance to the boundary. */
function distOutside(face: Face, p: Point): number {
  if (pointInPolygon(p, face.polygon)) return 0;
  return dist(p, closestPointOnPolyline(p, [...face.polygon, face.polygon[0]!]));
}

function consecutiveDuplicates(infos: SegmentInfo[]): string[] {
  const out: string[] = [];
  for (const info of infos) {
    for (let i = 1; i < info.axis.length; i++) {
      if (dist(info.axis[i]!, info.axis[i - 1]!) < 1e-9) out.push(`face ${info.faceId} idx ${i}`);
    }
  }
  return out;
}

// ── Shared shapes ──────────────────────────────────────────────────────────

const VLINE: Point[] = [
  { x: 500, y: 100 },
  { x: 500, y: 700 },
];

const arcPoints = (c: Point, r: number, a0: number, a1: number, n = 32): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });

/** hw 40→4 linear taper, cut at the thick end, round tip — the canonical thinning stroke. */
const taperFace = () => ribbonFace(VLINE, (t) => 40 - 36 * t, { kind: 'cut', cutId: 0 }, { kind: 'round' });
const TAPER_HW = (t: number) => 40 - 36 * t;

/** hw 40.5→0.5 needle: the tip region is thinner than the boundary sample step. */
const needleFace = () => ribbonFace(VLINE, (t) => 40.5 - 40 * t, { kind: 'cut', cutId: 0 }, { kind: 'flat' });

describe('medialFaceAxes — straight corridors', () => {
  test('two-cut strip: one straight centered axis, true widths, ends on both cuts', () => {
    const face = ribbonFace(VLINE, () => 30, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos!).toHaveLength(1);
    expect(infos![0]!.ends.map((e) => e.cutId).sort()).toEqual([0, 1]);
    expect(coverageViolations(infos!, VLINE, 12)).toEqual([]);
    expect(positionViolations(infos!, VLINE, 10)).toEqual([]);
    expect(widthViolations(infos!, VLINE, () => 30, 0.15, 6)).toEqual([]);
  });

  test('two-cut strip end directions point out through the cuts', () => {
    const face = ribbonFace(VLINE, () => 30, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 });
    const infos = axesOf(face)!;
    for (const end of infos[0]!.ends) {
      // Top end exits upward (−y), bottom end exits downward (+y).
      const wantY = end.point.y < 400 ? -1 : 1;
      expect(end.direction.y * wantY).toBeGreaterThan(0.7);
    }
  });

  test('cut-free stadium: the axis spans cap center to cap center', () => {
    const face = ribbonFace(VLINE, () => 30, { kind: 'round' }, { kind: 'round' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos![0]!.ends.map((e) => e.cutId)).toEqual([-1, -1]);
    expect(nearestD(infos!, { x: 500, y: 100 })).toBeLessThan(15);
    expect(nearestD(infos!, { x: 500, y: 700 })).toBeLessThan(15);
    expect(widthViolations(infos!, VLINE, () => 30, 0.15, 6)).toEqual([]);
  });

  test('one cut + round tip: axis runs from the cut midpoint to the cap center', () => {
    const face = ribbonFace(VLINE, () => 30, { kind: 'cut', cutId: 0 }, { kind: 'round' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    const primary = infos![0]!;
    expect(primary.ends[0]!.cutId).toBe(0);
    expect(primary.ends[1]!.cutId).toBe(-1);
    expect(dist(primary.axis[0]!, { x: 500, y: 100 })).toBeLessThan(8);
    // The pen-nib tip extension may run slightly past the cap center (with
    // tapering width) but must stay inside the cap.
    expect(dist(primary.axis[primary.axis.length - 1]!, { x: 500, y: 700 })).toBeLessThan(25);
    expect(penGap(infos!, { x: 500, y: 700 })).toBeLessThanOrEqual(8);
  });

  test('flat free caps: the axis stops half a width short but the pen covers the cap edge', () => {
    const face = ribbonFace(VLINE, () => 30, { kind: 'flat' }, { kind: 'flat' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(penGap(infos!, { x: 500, y: 100 })).toBeLessThanOrEqual(10);
    expect(penGap(infos!, { x: 500, y: 700 })).toBeLessThanOrEqual(10);
  });
});

describe('medialFaceAxes — thinning shapes (taper reach)', () => {
  test('linear taper: the axis follows the centerline all the way into the thin tip', () => {
    const infos = axesOf(taperFace());
    expect(infos).not.toBeNull();
    expect(coverageViolations(infos!, VLINE, 10)).toEqual([]);
    expect(positionViolations(infos!, VLINE, 12)).toEqual([]);
    expect(widthViolations(infos!, VLINE, TAPER_HW, 0.2, 8)).toEqual([]);
  });

  test('needle thinner than the sample step at the tip: the apex is still reached', () => {
    // Below width ≈ sampleStep/2 no boundary-sample triangle keeps an interior
    // circumcenter — the failure mode behind "the axis never reaches thin parts".
    const infos = axesOf(needleFace());
    expect(infos).not.toBeNull();
    const apex = { x: 500, y: 700 };
    expect(nearestD(infos!, apex)).toBeLessThan(15);
    expect(penGap(infos!, apex)).toBeLessThanOrEqual(12);
    expect(coverageViolations(infos!, VLINE, 12)).toEqual([]);
  });

  test('double taper (both ends thin, no cuts): both tips are reached', () => {
    const center: Point[] = [
      { x: 200, y: 400 },
      { x: 800, y: 400 },
    ];
    const face = ribbonFace(center, (t) => 2 + 34 * Math.sin(Math.PI * t), { kind: 'flat' }, { kind: 'flat' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(penGap(infos!, { x: 200, y: 400 })).toBeLessThanOrEqual(12);
    expect(penGap(infos!, { x: 800, y: 400 })).toBeLessThanOrEqual(12);
    expect(coverageViolations(infos!, center, 12)).toEqual([]);
  });

  test('sparse-sampled wedge (long straight walls): the axis still reaches the thin tip', () => {
    // Real outlines flatten straight stems into LONG edges, so boundary
    // samples sit a full step apart — and below width ≈ step/2 no triangle
    // keeps an interior circumcenter. The tip region must still be reached.
    const P: Point[] = [
      { x: 100, y: 385 },
      { x: 600, y: 399 },
      { x: 600, y: 401 },
      { x: 100, y: 415 },
    ];
    const face = buildFace(
      P,
      P.map((_, i) => (i === P.length - 1 ? 0 : -1)),
    );
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(penGap(infos!, { x: 595, y: 400 })).toBeLessThanOrEqual(12);
    const wedgeLine: Point[] = [
      { x: 100, y: 400 },
      { x: 600, y: 400 },
    ];
    expect(coverageViolations(infos!, wedgeLine, 12)).toEqual([]);
  });

  test('hairline neck between two blobs: both blobs stay on one connected axis', () => {
    // Long straight edges again, with the two neck walls at different sample
    // phases (unequal lengths) — misaligned samples across a width-3 neck
    // push circumcenters outside, so the graph loses the neck. Neither blob
    // may be dropped, and the neck itself must be swept.
    const P: Point[] = [
      { x: 100, y: 300 },
      { x: 340, y: 300 },
      { x: 340, y: 398.5 },
      { x: 460, y: 398.5 },
      { x: 460, y: 300 },
      { x: 700, y: 300 },
      { x: 700, y: 500 },
      { x: 463, y: 500 },
      { x: 463, y: 401.5 },
      { x: 337, y: 401.5 },
      { x: 337, y: 500 },
      { x: 100, y: 500 },
    ];
    const face = buildFace(
      P,
      P.map(() => -1),
    );
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(penGap(infos!, { x: 150, y: 400 })).toBeLessThanOrEqual(12);
    expect(penGap(infos!, { x: 650, y: 400 })).toBeLessThanOrEqual(12);
    expect(penGap(infos!, { x: 400, y: 400 })).toBeLessThanOrEqual(10);
  });

  test('densely-sampled thin neck stays connected without refinement', () => {
    const center: Point[] = [
      { x: 200, y: 400 },
      { x: 800, y: 400 },
    ];
    const hw = (t: number) => (Math.abs(t - 0.5) < 0.12 ? 1.5 : Math.abs(t - 0.5) < 0.2 ? 1.5 + (Math.abs(t - 0.5) - 0.12) * 480 : 40);
    const face = ribbonFace(center, hw, { kind: 'flat' }, { kind: 'flat' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(penGap(infos!, { x: 200, y: 400 })).toBeLessThanOrEqual(12);
    expect(penGap(infos!, { x: 800, y: 400 })).toBeLessThanOrEqual(12);
    expect(penGap(infos!, { x: 500, y: 400 })).toBeLessThanOrEqual(10);
  });

  test('taper widths shrink monotonically toward the tip', () => {
    const infos = axesOf(taperFace())!;
    const pts = allPoints(infos);
    const meanW = (y0: number, y1: number) => {
      const sel = pts.filter((p) => p.y >= y0 && p.y <= y1);
      return sel.reduce((s, p) => s + p.width, 0) / sel.length;
    };
    // Expected 2·hw: ~56 around y=300, ~20 around y=600.
    expect(meanW(250, 350) - meanW(550, 650)).toBeGreaterThan(25);
  });
});

describe('medialFaceAxes — bends and curls', () => {
  const BEND_CENTER = { x: 600, y: 600 };
  const bendLine = arcPoints(BEND_CENTER, 300, Math.PI, 1.5 * Math.PI);

  test('quarter-arc bend: the axis follows the arc, never the chord', () => {
    const face = ribbonFace(bendLine, () => 30, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(coverageViolations(infos!, bendLine, 12)).toEqual([]);
    expect(positionViolations(infos!, bendLine, 14)).toEqual([]);
    expect(widthViolations(infos!, bendLine, () => 30, 0.15, 8)).toEqual([]);
    // Every axis point stays on the annulus band — a chord shortcut would dip inside.
    for (const p of allPoints(infos!)) {
      expect(Math.abs(dist(p, BEND_CENTER) - 300)).toBeLessThanOrEqual(15);
    }
  });

  test('s-curve ribbon: the axis tracks through both inflections', () => {
    const sLine: Point[] = Array.from({ length: 49 }, (_, i) => {
      const x = 200 + (600 * i) / 48;
      return { x, y: 400 + 120 * Math.sin(((x - 200) / 600) * 2 * Math.PI) };
    });
    const face = ribbonFace(sLine, () => 26, { kind: 'round' }, { kind: 'round' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(coverageViolations(infos!, sLine, 12)).toEqual([]);
    expect(positionViolations(infos!, sLine, 14)).toEqual([]);
  });

  test('tapering hook (curled arm): the axis follows the curl into the thin tip', () => {
    // 250° sweep, width 60 → 16 — the shape class of Caveat r's curled arm.
    const hookLine = arcPoints({ x: 450, y: 400 }, 150, -Math.PI / 2, -Math.PI / 2 + (250 * Math.PI) / 180, 48);
    const face = ribbonFace(hookLine, (t) => 30 - 22 * t, { kind: 'cut', cutId: 0 }, { kind: 'round' });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(coverageViolations(infos!, hookLine, 12)).toEqual([]);
    expect(positionViolations(infos!, hookLine, 14)).toEqual([]);
    expect(widthViolations(infos!, hookLine, (t) => 30 - 22 * t, 0.2, 8)).toEqual([]);
  });
});

describe('medialFaceAxes — lobes and limbs', () => {
  /** Tall stalk whose two cuts converge at a shared base corner (w's fused peak). */
  function lobeFace(): Face {
    const A = { x: 450, y: 800 };
    const T1 = { x: 450, y: 200 };
    const T2 = { x: 550, y: 200 };
    const B = { x: 550, y: 800 };
    const C = { x: 500, y: 780 };
    return {
      id: 0,
      polygon: [A, T1, T2, B, C],
      edgeCutIds: [-1, -1, -1, 1, 0],
      holes: [],
      cutIds: [0, 1],
      area: 59000,
      centroid: { x: 500, y: 500 },
      kind: 'segment',
    };
  }

  test('two-port lobe: the hairpin retrace climbs the lobe and returns to the base', () => {
    const infos = axesOf(lobeFace());
    expect(infos).not.toBeNull();
    const primary = infos![0]!;
    expect(primary.ends.map((e) => e.cutId).sort()).toEqual([0, 1]);
    const ys = primary.axis.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(270);
    expect(primary.axis[0]!.y).toBeGreaterThan(700);
    expect(primary.axis[primary.axis.length - 1]!.y).toBeGreaterThan(700);
    expect(consecutiveDuplicates(infos!)).toEqual([]);
  });

  test('side arm off a stem (1 port): arm end and stem bottom are both covered', () => {
    // Rectilinear r: stem x 100–160 descending to y 700, arm y 400–460
    // reaching x 400, single cut at the top. One path serves one limb; the
    // other must come back as a branch axis.
    const P: Point[] = [
      { x: 160, y: 100 },
      { x: 160, y: 400 },
      { x: 400, y: 400 },
      { x: 400, y: 460 },
      { x: 160, y: 460 },
      { x: 160, y: 700 },
      { x: 100, y: 700 },
      { x: 100, y: 100 },
    ];
    const face = buildFace(
      P,
      P.map((_, i) => (i === P.length - 1 ? 0 : -1)),
    );
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos!.length).toBeGreaterThanOrEqual(2);
    expect(penGap(infos!, { x: 385, y: 430 })).toBeLessThanOrEqual(10);
    expect(penGap(infos!, { x: 130, y: 690 })).toBeLessThanOrEqual(10);
    expect(consecutiveDuplicates(infos!)).toEqual([]);
  });

  test('serif bump near a bar end folds into the bar as a flick, not a stroke', () => {
    // A Mincho uroko: a triangular pressure mark on top of a horizontal
    // bar's free end. It is real ink (it escapes the bar's disks) but the
    // hand draws it as the bar stroke's finishing flick — a short limb must
    // RETRACE into the primary, only long limbs become branch strokes.
    const P: Point[] = [
      { x: 100, y: 380 },
      { x: 560, y: 380 },
      { x: 590, y: 330 },
      { x: 620, y: 380 },
      { x: 700, y: 380 },
      { x: 700, y: 416 },
      { x: 100, y: 416 },
    ];
    const face = buildFace(
      P,
      P.map((_, i) => (i === P.length - 1 ? 0 : -1)),
    );
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos!).toHaveLength(1);
    expect(penGap(infos!, { x: 590, y: 345 })).toBeLessThanOrEqual(12);
  });

  test('serif on a small two-port pass-through face is still swept', () => {
    // Shippori 永's left-sweep serif: a pen-scale 2-cut face whose tree
    // diameter barely exceeds its width, carrying a serif limb. However
    // small the face, escaped ink must be retraced into the through-axis —
    // a blob-style "the dab covers it" shortcut silently drops the serif.
    const P: Point[] = [
      { x: 100, y: 380 },
      { x: 130, y: 380 },
      { x: 160, y: 335 },
      { x: 190, y: 380 },
      { x: 220, y: 380 },
      { x: 220, y: 450 },
      { x: 100, y: 450 },
    ];
    const tags = P.map((_, i) => (i === 4 ? 1 : i === P.length - 1 ? 0 : -1));
    const face = buildFace(P, tags);
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos![0]!.ends.map((e) => e.cutId).sort()).toEqual([0, 1]);
    expect(penGap(infos!, { x: 160, y: 350 })).toBeLessThanOrEqual(12);
  });

  test('rhombic dot (Arabic-style): one dab axis, no corner tick limbs', () => {
    // A dot's whole face is pen-scale — its medial tree has short-diagonal
    // corner chains that escape the center disk, but drawing them as limb
    // strokes renders spurious ticks on every diacritic dot.
    const dot = buildFace(
      [
        { x: 436, y: 200 },
        { x: 500, y: 142 },
        { x: 564, y: 200 },
        { x: 500, y: 258 },
      ],
      [-1, -1, -1, -1],
    );
    const infos = axesOf(dot);
    expect(infos).not.toBeNull();
    expect(infos!).toHaveLength(1);
    // The dab axis spans the long diagonal, not a corner tick.
    const axis = infos![0]!.axis;
    const xs = axis.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });

  test('small wall bump on a strip: no detour, no phantom branch', () => {
    // Bump depth 15 (< half-width 30) over a 100-unit window — inside the
    // pen's reach, so it must neither branch nor bend the primary off course.
    const pts: Point[] = [
      { x: 470, y: 100 },
      { x: 530, y: 100 },
      { x: 530, y: 340 },
      { x: 545, y: 365 },
      { x: 545, y: 435 },
      { x: 530, y: 460 },
      { x: 530, y: 700 },
      { x: 470, y: 700 },
    ];
    const tags = pts.map((_, i) => (i === 0 ? 0 : i === 6 ? 1 : -1));
    const face = buildFace(pts, tags);
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(infos!).toHaveLength(1);
    for (const p of infos![0]!.axis) expect(Math.abs(p.x - 500)).toBeLessThanOrEqual(14);
  });
});

describe('medialFaceAxes — robustness and degenerate input', () => {
  test('sliver thinner than the sample step still yields a centered, covering axis', () => {
    const short: Point[] = [
      { x: 500, y: 100 },
      { x: 500, y: 500 },
    ];
    const face = ribbonFace(short, () => 4, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 });
    const infos = axesOf(face);
    expect(infos).not.toBeNull();
    expect(coverageViolations(infos!, short, 8)).toEqual([]);
    expect(positionViolations(infos!, short, 8)).toEqual([]);
    for (const p of allPoints(infos!)) expect(p.width).toBeLessThanOrEqual(10);
  });

  test('tiny dot face degrades to null (fallback) or a sane in-place axis, never garbage', () => {
    const dot = buildFace(
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return { x: 500 + 6 * Math.cos(a), y: 500 + 6 * Math.sin(a) };
      }),
      Array.from({ length: 16 }, () => -1),
    );
    const infos = axesOf(dot);
    if (infos) {
      for (const p of allPoints(infos)) expect(dist(p, { x: 500, y: 500 })).toBeLessThan(12);
    }
  });

  test('exactly-collinear zero-area polygon returns null without hanging', () => {
    const face = buildFace(
      [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 700, y: 100 },
        { x: 500, y: 100 },
      ],
      [-1, -1, -1, -1],
    );
    expect(medialFaceAxes(face, OPTIONS)).toBeNull();
  });

  test('axis points never leave the face', () => {
    const shapes: Face[] = [
      ribbonFace(VLINE, () => 30, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 }),
      taperFace(),
      needleFace(),
      ribbonFace(
        arcPoints({ x: 600, y: 600 }, 300, Math.PI, 1.5 * Math.PI),
        () => 30,
        { kind: 'cut', cutId: 1 },
        { kind: 'cut', cutId: 0 },
      ),
    ];
    for (const face of shapes) {
      const infos = axesOf(face);
      expect(infos).not.toBeNull();
      for (const p of allPoints(infos!)) expect(distOutside(face, p)).toBeLessThanOrEqual(2);
    }
  });

  test('the medial axis is deterministic', () => {
    const a = medialFaceAxes(taperFace(), OPTIONS);
    const b = medialFaceAxes(taperFace(), OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('computeSegmentAxes (voronoi) — pipeline entry', () => {
  test('needle taper keeps tip coverage through the pipeline entry', () => {
    const infos = computeSegmentAxes(needleFace(), OPTIONS_VORONOI);
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(penGap(infos, { x: 500, y: 700 })).toBeLessThanOrEqual(12);
  });

  test('hairline strip (width 4) still covers end to end', () => {
    const short: Point[] = [
      { x: 500, y: 100 },
      { x: 500, y: 500 },
    ];
    const face = ribbonFace(short, () => 2, { kind: 'cut', cutId: 1 }, { kind: 'cut', cutId: 0 });
    const infos = computeSegmentAxes(face, OPTIONS_VORONOI);
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(penGap(infos, { x: 500, y: 120 })).toBeLessThanOrEqual(8);
    expect(penGap(infos, { x: 500, y: 480 })).toBeLessThanOrEqual(8);
  });
});
