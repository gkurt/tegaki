import { beforeAll, describe, expect, test } from 'bun:test';
import type { PathCommand, Point } from 'tegaki';
import { initStraightSkeleton } from './face-straight-skeleton.ts';
import type { GeometryPipelineInput } from './pipeline.ts';
import { runGeometryPipeline } from './pipeline.ts';
import { DEFAULT_GEOMETRY_OPTIONS, type GeometryOptions } from './types.ts';

const UPM = 1000;

// These tests run the pipeline with DEFAULT options, and the default medial
// method needs its wasm module loaded once.
beforeAll(async () => {
  await initStraightSkeleton();
});

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

/** The partition extraction: most suites here pin its corners, cuts and faces. */
const PARTITION: GeometryOptions = { ...DEFAULT_GEOMETRY_OPTIONS, extraction: 'partition' };

function run(char: string, commands: PathCommand[], options = PARTITION) {
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
  return runGeometryPipeline(input, { commands }, options);
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

describe('geometry pipeline — defaults', () => {
  test('the default medial method is the exact straight skeleton', () => {
    // The chain approximation loses whole limbs on descender/loop faces
    // (Caveat r's descender, Klee One そ/ゆ/れ/わ), and voronoi's sampled
    // axis wobbles at junction mouths. The straight skeleton reaches every
    // limb exactly and is what the merged-shape trial join scores against —
    // the default must match or the join ranking measures a different axis
    // than the one strokes are built from.
    expect(DEFAULT_GEOMETRY_OPTIONS.medialMethod).toBe('straight-skeleton');
  });
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
    // (The stem is the tall stroke. Its axis legitimately ends half a width
    // above the glyph's bottom edge — the round cap covers the rest — so it
    // is selected by span, not by how close it gets to y=900.)
    const spanOf = (s: (typeof r.geoStrokes)[number], pick: (p: Point) => number) => {
      const vals = s.points.map(pick);
      return Math.max(...vals) - Math.min(...vals);
    };
    const stem = r.geoStrokes.find((s) => spanOf(s, (p) => p.y) > spanOf(s, (p) => p.x))!;
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

  test('a ring crossed by a separate bar keeps its counter (Caveat R/Q construction)', () => {
    // Overlapping-stroke glyphs draw each pen stroke as its own contour and
    // rely on nonzero-winding union. The ring's counter must ride with the
    // ring even though the ring CROSSES the bar — the region split used to
    // orphan it (nesting only looked at non-crossing contours), and the hole
    // came back as standalone solid ink with its own axis stroke.
    const outer = circle(500, 400, 300);
    const hole = circle(500, 400, 180);
    const bar = rect(460, 620, 540, 1000); // crosses the ring's lower boundary
    const r = run('Q', commandsFromPolygons(outer, hole, bar));
    expect(r.contours.filter((c) => c.isHole).length).toBe(1);
    expect(r.strokesFontUnits.length).toBe(2);
    expect(r.geoStrokes.some((s) => s.isLoop)).toBe(true);
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

describe('geometry pipeline — dataset stroke order', () => {
  // Two disjoint vertical bars. Heuristic order: left first, both top-to-bottom.
  const twoBars = () => commandsFromPolygons(rect(200, 100, 320, 900), rect(600, 100, 720, 900));

  /**
   * Reference in a 109x109 dataset frame prescribing the OPPOSITE of the
   * heuristic: right bar first, both drawn bottom-to-top. Centerlines at
   * x=30/x=90 spanning y=10..90 register close to the extracted axes.
   */
  const reversedReference = () => ({
    char: 'Ⅱ',
    strokes: [
      {
        points: [
          { x: 90, y: 90 },
          { x: 90, y: 10 },
        ],
      },
      {
        points: [
          { x: 30, y: 90 },
          { x: 30, y: 10 },
        ],
      },
    ],
    viewBox: { width: 109, height: 109 },
    source: 'test',
    license: 'test',
  });

  function runWithReference(reference: ReturnType<typeof reversedReference> | undefined, strokeOrder: 'auto' | 'dataset' | 'heuristic') {
    const input: GeometryPipelineInput = {
      char: 'Ⅱ',
      unicode: 0x2161,
      advanceWidth: UPM,
      boundingBox: { x1: 0, y1: 0, x2: UPM, y2: UPM },
      pathString: '',
      ascender: 800,
      descender: -200,
      unitsPerEm: UPM,
      ...(reference ? { reference } : {}),
    };
    return runGeometryPipeline(input, { commands: twoBars() }, { ...DEFAULT_GEOMETRY_OPTIONS, strokeOrder });
  }

  test('auto: a clean match applies dataset order and direction', () => {
    const r = runWithReference(reversedReference(), 'auto');
    expect(r.strokeOrderSource).toBe('dataset');
    expect(r.reference).toBeDefined();
    expect(r.strokesFontUnits.length).toBe(2);
    // Right bar drawn first…
    expect(r.strokesFontUnits[0]!.points[0]!.x).toBeGreaterThan(500);
    expect(r.strokesFontUnits[1]!.points[0]!.x).toBeLessThan(500);
    // …and both strokes travel bottom-to-top as the reference prescribes.
    for (const stroke of r.strokesFontUnits) {
      expect(stroke.points[0]!.y).toBeGreaterThan(stroke.points[stroke.points.length - 1]!.y);
    }
  });

  test('heuristic: the reference is registered for display but never applied', () => {
    const r = runWithReference(reversedReference(), 'heuristic');
    expect(r.strokeOrderSource).toBe('heuristic');
    expect(r.reference).toBeDefined();
    // Heuristic order: left bar first, top-to-bottom.
    expect(r.strokesFontUnits[0]!.points[0]!.x).toBeLessThan(500);
    for (const stroke of r.strokesFontUnits) {
      expect(stroke.points[0]!.y).toBeLessThan(stroke.points[stroke.points.length - 1]!.y);
    }
  });

  test('auto: count mismatch falls back to heuristic with a warning', () => {
    const ref = reversedReference();
    ref.strokes.push({
      points: [
        { x: 60, y: 10 },
        { x: 60, y: 90 },
      ],
    });
    const r = runWithReference(ref, 'auto');
    expect(r.strokeOrderSource).toBe('heuristic');
    expect(r.warnings.some((w) => w.includes('3 reference vs 2 extracted'))).toBe(true);
    expect(r.strokesFontUnits[0]!.points[0]!.x).toBeLessThan(500);
  });

  test('dataset: count mismatch is forced with a warning', () => {
    const ref = reversedReference();
    ref.strokes.push({
      points: [
        { x: 60, y: 10 },
        { x: 60, y: 90 },
      ],
    });
    const r = runWithReference(ref, 'dataset');
    expect(r.strokeOrderSource).toBe('dataset');
    expect(r.warnings.some((w) => w.includes('forced dataset match'))).toBe(true);
    // The matched ordering still puts the right bar first.
    expect(r.strokesFontUnits[0]!.points[0]!.x).toBeGreaterThan(500);
  });

  test('auto: a wildly different reference is rejected on cost, not applied', () => {
    // Horizontal reference strokes against vertical bars.
    const ref = reversedReference();
    ref.strokes = [
      {
        points: [
          { x: 10, y: 30 },
          { x: 100, y: 30 },
        ],
      },
      {
        points: [
          { x: 10, y: 90 },
          { x: 100, y: 90 },
        ],
      },
    ];
    const r = runWithReference(ref, 'auto');
    expect(r.strokeOrderSource).toBe('heuristic');
    expect(r.warnings.some((w) => w.includes('match cost'))).toBe(true);
  });

  test('no reference: all modes behave identically (heuristic)', () => {
    const r = runWithReference(undefined, 'auto');
    expect(r.strokeOrderSource).toBe('heuristic');
    expect(r.reference).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });
});

describe('geometry pipeline — dataset re-grouping', () => {
  function runGlyph(char: string, commands: PathCommand[], reference: GeometryPipelineInput['reference']) {
    const input: GeometryPipelineInput = {
      char,
      unicode: char.codePointAt(0) ?? 0,
      advanceWidth: UPM,
      boundingBox: { x1: 0, y1: 0, x2: UPM, y2: UPM },
      pathString: '',
      ascender: 800,
      descender: -200,
      unitsPerEm: UPM,
      reference,
    };
    return runGeometryPipeline(input, { commands });
  }

  test('a box annulus splits into the three prescribed strokes (口)', () => {
    // Square ring: extracted as ONE closed loop (corner turns merge through
    // bare cuts — no junction exists anywhere to re-pair). The reference
    // prescribes left / top+right / bottom; only re-grouping can honor it.
    const commands = commandsFromPolygons(rect(200, 200, 800, 800), rect(320, 320, 680, 680));
    const reference = {
      char: '口',
      strokes: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 10, y: 90 },
          ],
        },
        {
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 90 },
          ],
        },
        {
          points: [
            { x: 10, y: 90 },
            { x: 90, y: 90 },
          ],
        },
      ],
      viewBox: { width: 109, height: 109 },
      source: 'test',
      license: 'test',
    };
    const r = runGlyph('口', commands, reference);
    expect(r.geoStrokes.length).toBe(3);
    expect(r.strokesFontUnits.length).toBe(3);
    expect(r.strokeOrderSource).toBe('dataset');
    expect(r.strokeOrderRegrouped).toBe(true);
    expect(r.warnings.some((w) => w.includes('re-grouped'))).toBe(true);
    // Stroke 1 is the left vertical, drawn top-to-bottom.
    const first = r.strokesFontUnits[0]!;
    expect(Math.max(...first.points.map((p) => p.x))).toBeLessThan(350);
    expect(first.points[0]!.y).toBeLessThan(first.points[first.points.length - 1]!.y);
  });

  test('overlapping-contour pieces of one prescribed stroke merge across regions (∟)', () => {
    // Vertical and horizontal bars drawn as SEPARATE overlapping contours —
    // they land in different pipeline regions, so no junction pairing could
    // ever join them. The reference says they are one pen stroke.
    const commands = commandsFromPolygons(rect(200, 100, 280, 700), rect(200, 620, 700, 700));
    const reference = {
      char: '∟',
      strokes: [
        {
          points: [
            { x: 15, y: 10 },
            { x: 15, y: 90 },
            { x: 90, y: 90 },
          ],
        },
      ],
      viewBox: { width: 109, height: 109 },
      source: 'test',
      license: 'test',
    };
    const r = runGlyph('∟', commands, reference);
    expect(r.geoStrokes.length).toBe(1);
    expect(r.strokesFontUnits.length).toBe(1);
    expect(r.strokeOrderSource).toBe('dataset');
    expect(r.strokeOrderRegrouped).toBe(true);
    // The pen travels down the stem then out along the foot.
    const stroke = r.strokesFontUnits[0]!;
    expect(stroke.points[0]!.y).toBeLessThan(300);
    expect(stroke.points[stroke.points.length - 1]!.x).toBeGreaterThan(500);
  });

  test('reference variants: the best-matching dataset wins (print vs cursive styles)', () => {
    // One vertical bar of ink. Variant 'print3' prescribes three horizontal
    // strokes (a hopeless style mismatch); variant 'cursive1' prescribes the
    // single vertical. The pipeline must evaluate both and adopt cursive1.
    const commands = commandsFromPolygons(rect(400, 100, 480, 900));
    const bar = (y: number) => ({
      points: [
        { x: 10, y },
        { x: 100, y },
      ],
    });
    const print3 = {
      char: 'ǀ',
      strokes: [bar(20), bar(55), bar(90)],
      viewBox: { width: 109, height: 109 },
      source: 'print3',
      license: 'test',
    };
    const cursive1 = {
      char: 'ǀ',
      strokes: [
        {
          points: [
            { x: 55, y: 10 },
            { x: 55, y: 100 },
          ],
        },
      ],
      viewBox: { width: 109, height: 109 },
      source: 'cursive1',
      license: 'test',
    };
    const r = runGlyph('ǀ', commands, [print3, cursive1]);
    expect(r.strokeOrderSource).toBe('dataset');
    expect(r.reference?.source).toBe('cursive1');
    expect(r.strokesFontUnits.length).toBe(1);
    expect(r.warnings.some((w) => w.includes("adopted 'cursive1'"))).toBe(true);
  });

  test('a rejected re-grouping keeps the heuristic strokes untouched', () => {
    // Two disjoint bars against one diagonal reference nowhere near them: the
    // merge gap check fails and any candidate re-matches unclean, so the
    // heuristic grouping and order must survive unchanged.
    const commands = commandsFromPolygons(rect(200, 100, 320, 900), rect(600, 100, 720, 900));
    const reference = {
      char: 'Ⅱ',
      strokes: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 100 },
          ],
        },
      ],
      viewBox: { width: 109, height: 109 },
      source: 'test',
      license: 'test',
    };
    const r = runGlyph('Ⅱ', commands, reference);
    expect(r.strokeOrderSource).toBe('heuristic');
    expect(r.strokeOrderRegrouped).toBeUndefined();
    expect(r.strokesFontUnits.length).toBe(2);
    expect(r.strokesFontUnits[0]!.points[0]!.x).toBeLessThan(500);
  });
});

describe('geometry pipeline — ink-graph extraction', () => {
  const ink = { ...DEFAULT_GEOMETRY_OPTIONS, extraction: 'ink-graph' as const };

  test('the ink-graph extraction is the default', () => {
    expect(DEFAULT_GEOMETRY_OPTIONS.extraction).toBe('ink-graph');
  });

  test('T through the full pipeline: crossbar + stem, ordered and reference-built', () => {
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
    const r = run('T', commandsFromPolygons(outline), ink);
    // No corners or cuts: the ink graph reads topology off the triangulation.
    expect(r.corners.length).toBe(0);
    expect(r.cuts.length).toBe(0);
    expect(r.strokesFontUnits.length).toBe(2);
  });

  test('ring (O) through the full pipeline: one loop stroke', () => {
    const r = run('O', commandsFromPolygons(circle(500, 500, 350), circle(500, 500, 200)), ink);
    expect(r.strokesFontUnits.length).toBe(1);
  });
});
