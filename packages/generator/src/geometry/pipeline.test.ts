import { describe, expect, test } from 'bun:test';
import type { PathCommand, Point } from 'tegaki';
import type { GeometryPipelineInput } from './pipeline.ts';
import { runGeometryPipeline } from './pipeline.ts';

const UPM = 1000;

/** Build M/L…Z path commands from one or more closed polygons. */
function commandsFromPolygons(...polygons: Point[][]): PathCommand[] {
  const cmds: PathCommand[] = [];
  for (const poly of polygons) {
    poly.forEach((p, i) => {
      cmds.push({ type: i === 0 ? 'M' : 'L', x: p.x, y: p.y });
    });
    cmds.push({ type: 'Z', x: poly[0]!.x, y: poly[0]!.y });
  }
  return cmds;
}

function run(char: string, commands: PathCommand[]) {
  const input: GeometryPipelineInput = {
    char,
    unicode: char.codePointAt(0) ?? 0,
    advanceWidth: UPM,
    boundingBox: { x1: 0, y1: 0, x2: UPM, y2: UPM },
    pathString: '',
    ascender: 800,
    descender: -200,
    unitsPerEm: UPM,
  };
  return runGeometryPipeline(input, { commands });
}

// Coordinates use a y-down convention (screen space) like opentype's getPath,
// but the pipeline reorients contours itself, so winding here is irrelevant.

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

/** Regular polygon approximating a circle (many sides ⇒ no sharp corners). */
const circle = (cx: number, cy: number, radius: number, sides = 48): Point[] =>
  Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });

describe('geometry pipeline — primitives', () => {
  test('vertical bar: no concave corners, single stroke', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 600, 900)));
    expect(r.corners.length).toBe(0);
    expect(r.cuts.length).toBe(0);
    expect(r.faces.length).toBe(1);
    expect(r.segments.length).toBe(1);
    expect(r.strokesFontUnits.length).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  test('ring (O): smooth outer + hole → one loop stroke, no corners', () => {
    // Smooth ring (like a real font O): no sharp inner corners. A *rectangular*
    // hole would have 4 genuinely-concave inner corners, so circles are used.
    const outer = circle(500, 500, 400);
    const hole = circle(500, 500, 220);
    const r = run('O', commandsFromPolygons(outer, hole));
    expect(r.contours.length).toBe(2);
    expect(r.contours.some((c) => c.isHole)).toBe(true);
    expect(r.corners.length).toBe(0);
    expect(r.cuts.length).toBe(0);
    // Exactly one hole (the counter) attached across all faces — the
    // arrangement's exterior/unbounded cycle must NOT be attached as a second
    // hole (that regression filled the counter instead of the ring and gave the
    // annulus a zero-width axis).
    expect(r.faces.reduce((n, f) => n + f.holes.length, 0)).toBe(1);
    // One annular segment forming a closed loop.
    const loops = r.segments.filter((s) => s.isLoop);
    expect(loops.length).toBe(1);
    expect(r.strokesFontUnits.length).toBe(1);
  });

  test('small dot: single blob stroke', () => {
    const r = run('.', commandsFromPolygons(rect(450, 750, 550, 850)));
    expect(r.corners.length).toBe(0);
    expect(r.strokesFontUnits.length).toBe(1);
  });
});

describe('geometry pipeline — junctions', () => {
  test('T: two concave corners, one junction, crossbar merges → 2 strokes', () => {
    // Bar y 100–250 across x 100–900; stem x 400–600 down to y 900.
    const outline: Point[] = [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 250 },
      { x: 600, y: 250 },
      { x: 600, y: 900 },
      { x: 400, y: 900 },
      { x: 400, y: 250 },
      { x: 100, y: 250 },
    ];
    const r = run('T', commandsFromPolygons(outline));
    expect(r.corners.length).toBe(2);
    expect(r.junctions.length).toBeGreaterThanOrEqual(1);
    // Left+right bar halves are collinear → one crossbar; stem is separate.
    expect(r.strokesFontUnits.length).toBe(2);
    // The stem's unpaired end must EXTEND into the bar junction (the pen
    // writes the stem into the bar) — not stop at the bar's bottom edge
    // (y=250), which would leave the junction quad unswept by the stem.
    const stem = r.geoStrokes.find((s) => Math.max(...s.points.map((p) => p.y)) > 800)!;
    expect(stem).toBeDefined();
    const stemTop = Math.min(...stem.points.map((p) => p.y));
    expect(stemTop).toBeLessThan(240);
    expect(stemTop).toBeGreaterThan(100);
  });

  test('plus (+): four concave corners → 2 crossing strokes', () => {
    // Cross: horizontal arm y 400–600 (x 100–900), vertical arm x 400–600 (y 100–900).
    const outline: Point[] = [
      { x: 400, y: 100 },
      { x: 600, y: 100 },
      { x: 600, y: 400 },
      { x: 900, y: 400 },
      { x: 900, y: 600 },
      { x: 600, y: 600 },
      { x: 600, y: 900 },
      { x: 400, y: 900 },
      { x: 400, y: 600 },
      { x: 100, y: 600 },
      { x: 100, y: 400 },
      { x: 400, y: 400 },
    ];
    const r = run('+', commandsFromPolygons(outline));
    expect(r.corners.length).toBe(4);
    expect(r.junctions.length).toBeGreaterThanOrEqual(1);
    // Opposite arms are collinear and merge: vertical + horizontal = 2 strokes.
    expect(r.strokesFontUnits.length).toBe(2);
  });

  test('L: single concave elbow corner', () => {
    // Vertical arm x 100–300 (y 100–900), foot y 700–900 (x 100–700).
    const outline: Point[] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 700 },
      { x: 700, y: 700 },
      { x: 700, y: 900 },
      { x: 100, y: 900 },
    ];
    const r = run('L', commandsFromPolygons(outline));
    expect(r.corners.length).toBe(1);
    // The elbow is a compact 2-cut TURN face — a segment, not a junction — so
    // arm → elbow → foot chain into exactly one pen stroke.
    expect(r.faces.every((f) => f.kind === 'segment')).toBe(true);
    expect(r.strokesFontUnits.length).toBe(1);
  });

  test('arch (∩): elongated 2-cut faces are segments, whole arch is one stroke', () => {
    // Legs x 100–200 / x 400–500 (y 300–900), top bar y 100–300. The two
    // concave corners at the gap bottom carve the top bar out as a 2-cut face.
    // Regression: the 2-cut compactness heuristic classified such faces as
    // junctions, collapsing them into centroid bridges (the cursive-w failure).
    const outline: Point[] = [
      { x: 100, y: 900 },
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 900 },
      { x: 400, y: 900 },
      { x: 400, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 900 },
    ];
    const r = run('n', commandsFromPolygons(outline));
    expect(r.corners.length).toBe(2);
    expect(r.faces.every((f) => f.kind === 'segment')).toBe(true);
    expect(r.strokesFontUnits.length).toBe(1);
    // The stroke must travel through the top bar, not shortcut across the gap.
    const minY = Math.min(...r.geoStrokes.flatMap((s) => s.points.map((p) => p.y)));
    expect(minY).toBeLessThan(260);
  });
});
