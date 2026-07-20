import { beforeAll, describe, expect, test } from 'bun:test';
import type { Point } from 'tegaki';
import { initStraightSkeleton, straightSkeletonJoinAlignment } from './face-straight-skeleton.ts';
import { signedArea } from './primitives.ts';
import { trialJoinAlignment } from './trial-join.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type Face, type JunctionInfo, resolveGeometryOptions, type SegmentInfo } from './types.ts';

const OPTIONS = resolveGeometryOptions({ ...DEFAULT_GEOMETRY_OPTIONS, medialMethod: 'straight-skeleton' }, 1000);

beforeAll(async () => {
  await initStraightSkeleton();
});

/** Build a Face, reorienting to region-on-left and remapping edge tags. */
function buildFace(id: number, points: Point[], edgeCutIds: number[]): Face {
  let polygon = points;
  let tags = edgeCutIds;
  if (signedArea(points) < 0) {
    const n = points.length;
    polygon = [...points].reverse();
    tags = polygon.map((_, j) => edgeCutIds[(n - 2 - j + n) % n]!);
  }
  const c = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return {
    id,
    polygon,
    edgeCutIds: tags,
    holes: [],
    cutIds: [...new Set(tags.filter((t) => t >= 0))],
    area: Math.abs(signedArea(points)),
    centroid: { x: c.x / polygon.length, y: c.y / polygon.length },
    kind: 'segment',
  };
}

// A plus-crossing fixture: a 60-wide horizontal ribbon and a 60-wide vertical
// ribbon crossing at a kernel square. Arms are separate faces cut off at the
// kernel; the kernel keeps all four cuts.
//
//                 (up arm not modeled — its cut just survives on the boundary)
//   left  A: 0..200 × 0..60      cut0 = A|K at x=200
//   kernel K: 200..260 × 0..60   cut1 = K|B at x=260, cut2 = K|D at y=60, cut3 (up) at y=0
//   right B: 260..460 × 0..60
//   down  D: 200..260 × 60..300
const faceA = () =>
  buildFace(
    0,
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 60 },
      { x: 0, y: 60 },
    ],
    [-1, 0, -1, -1],
  );
const faceK = () =>
  buildFace(
    1,
    [
      { x: 200, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 60 },
      { x: 200, y: 60 },
    ],
    [3, 1, 2, 0],
  );
const faceB = () =>
  buildFace(
    2,
    [
      { x: 260, y: 0 },
      { x: 460, y: 0 },
      { x: 460, y: 60 },
      { x: 260, y: 60 },
    ],
    [-1, -1, -1, 1],
  );
const faceD = () =>
  buildFace(
    3,
    [
      { x: 200, y: 60 },
      { x: 260, y: 60 },
      { x: 260, y: 300 },
      { x: 200, y: 300 },
    ],
    [2, -1, -1, -1],
  );

const W = 60;
const segLeft = (): SegmentInfo => ({
  faceId: 0,
  axis: [
    { x: 10, y: 30, width: W },
    { x: 190, y: 30, width: W },
  ],
  isLoop: false,
  ends: [
    { cutId: -1, point: { x: 10, y: 30 }, direction: { x: -1, y: 0 }, width: W },
    { cutId: 0, point: { x: 200, y: 30 }, direction: { x: 1, y: 0 }, width: W },
  ],
});
const segRight = (): SegmentInfo => ({
  faceId: 2,
  axis: [
    { x: 270, y: 30, width: W },
    { x: 450, y: 30, width: W },
  ],
  isLoop: false,
  ends: [
    { cutId: 1, point: { x: 260, y: 30 }, direction: { x: -1, y: 0 }, width: W },
    { cutId: -1, point: { x: 450, y: 30 }, direction: { x: 1, y: 0 }, width: W },
  ],
});
const segDown = (): SegmentInfo => ({
  faceId: 3,
  axis: [
    { x: 230, y: 70, width: W },
    { x: 230, y: 290, width: W },
  ],
  isLoop: false,
  ends: [
    { cutId: 2, point: { x: 230, y: 60 }, direction: { x: 0, y: -1 }, width: W },
    { cutId: -1, point: { x: 230, y: 290 }, direction: { x: 0, y: 1 }, width: W },
  ],
});

const kernelJunction = (): JunctionInfo => ({
  faceIds: [1],
  centroid: { x: 230, y: 30 },
  incident: [],
  pairings: [],
  routes: [],
  extensions: [],
});

function crossingFixture() {
  const segments = [segLeft(), segRight(), segDown()];
  const faceById = new Map([faceA(), faceK(), faceB(), faceD()].map((f) => [f.id, f]));
  const segmentMemberFaces = new Map([
    [0, [0]],
    [1, [2]],
    [2, [3]],
  ]);
  return { segments, faceById, segmentMemberFaces };
}

describe('straightSkeletonJoinAlignment', () => {
  test('straight merged ribbon scores as flowing straight through (cos ≈ 1)', () => {
    // The already-merged union of two collinear arms: a plain 400×60 ribbon
    // whose mouth cut cancelled away. Both mouths sit at the old cut.
    const region = buildFace(
      0,
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 60 },
        { x: 0, y: 60 },
      ],
      [-1, -1, -1, -1],
    );
    const mouth = { cutId: 0, point: { x: 200, y: 30 }, direction: { x: 1, y: 0 }, width: W };
    const alignment = straightSkeletonJoinAlignment(
      region,
      OPTIONS,
      [mouth, { ...mouth, direction: { x: -1, y: 0 } }],
      [
        { x: 10, y: 30, width: W },
        { x: 390, y: 30, width: W },
      ],
    );
    expect(alignment).not.toBeNull();
    expect(alignment!).toBeGreaterThan(0.9);
  });

  test('L-shaped merged region scores as a ~90° turn (cos ≈ 0)', () => {
    // Union of a horizontal and a vertical arm meeting at a corner.
    const region = buildFace(
      0,
      [
        { x: 0, y: 0 },
        { x: 260, y: 0 },
        { x: 260, y: 300 },
        { x: 200, y: 300 },
        { x: 200, y: 60 },
        { x: 0, y: 60 },
      ],
      [-1, -1, -1, -1, -1, -1],
    );
    const alignment = straightSkeletonJoinAlignment(
      region,
      OPTIONS,
      [
        { cutId: 0, point: { x: 200, y: 30 }, direction: { x: 1, y: 0 }, width: W },
        { cutId: 0, point: { x: 230, y: 60 }, direction: { x: 0, y: -1 }, width: W },
      ],
      [
        { x: 10, y: 30, width: W },
        { x: 230, y: 290, width: W },
      ],
    );
    expect(alignment).not.toBeNull();
    expect(Math.abs(alignment!)).toBeLessThan(0.4);
  });
});

describe('trialJoinAlignment', () => {
  test('at a plus crossing, the straight-through join outranks the perpendicular one', () => {
    const { segments, faceById, segmentMemberFaces } = crossingFixture();
    const straight = trialJoinAlignment(
      segments,
      { segmentIndex: 0, endIndex: 1 },
      { segmentIndex: 1, endIndex: 0 },
      kernelJunction(),
      faceById,
      segmentMemberFaces,
      OPTIONS,
    );
    const bent = trialJoinAlignment(
      segments,
      { segmentIndex: 0, endIndex: 1 },
      { segmentIndex: 2, endIndex: 0 },
      kernelJunction(),
      faceById,
      segmentMemberFaces,
      OPTIONS,
    );
    expect(straight).not.toBeNull();
    expect(bent).not.toBeNull();
    expect(straight!).toBeGreaterThan(0.9);
    expect(bent!).toBeLessThan(0.4);
  });

  test('a merge the edge cancellation rejects returns null (caller keeps the tangent score)', () => {
    const { segments, faceById, segmentMemberFaces } = crossingFixture();
    // Drop the kernel from the junction: left and right arms no longer share
    // an edge, so the union is two disconnected rectangles — two outer rings.
    const junction: JunctionInfo = { ...kernelJunction(), faceIds: [] };
    const result = trialJoinAlignment(
      segments,
      { segmentIndex: 0, endIndex: 1 },
      { segmentIndex: 1, endIndex: 0 },
      junction,
      faceById,
      segmentMemberFaces,
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  test('loop segments are never trialed', () => {
    const { segments, faceById, segmentMemberFaces } = crossingFixture();
    segments[1] = { ...segments[1]!, isLoop: true };
    const result = trialJoinAlignment(
      segments,
      { segmentIndex: 0, endIndex: 1 },
      { segmentIndex: 1, endIndex: 0 },
      kernelJunction(),
      faceById,
      segmentMemberFaces,
      OPTIONS,
    );
    expect(result).toBeNull();
  });
});
