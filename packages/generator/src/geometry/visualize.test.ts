import { beforeAll, describe, expect, test } from 'bun:test';
import type { PathCommand, Point } from 'tegaki/internal';
import { initStraightSkeleton } from './face-straight-skeleton.ts';
import { type GeometryPipelineInput, runGeometryPipeline } from './pipeline.ts';
import { renderGeometryStage } from './visualize.ts';

const UPM = 1000;

beforeAll(async () => {
  await initStraightSkeleton();
});

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

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

describe('order stage', () => {
  test('every stroke gets a numbered start badge, in draw order', () => {
    // Two disjoint vertical bars ⇒ two strokes, ordered left-to-right.
    const r = run('Ⅱ', commandsFromPolygons(rect(200, 100, 320, 900), rect(600, 100, 720, 900)));
    expect(r.strokesFontUnits.length).toBe(2);
    const svg = renderGeometryStage(r, 'order');
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
    expect(svg).not.toContain('>3</text>');
  });

  test('strokes carry pen-direction arrowheads', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 520, 900)));
    const svg = renderGeometryStage(r, 'order');
    expect(svg).toContain('<polygon');
  });

  test('consecutive strokes are linked by a dashed pen-travel connector', () => {
    const r = run('Ⅱ', commandsFromPolygons(rect(200, 100, 320, 900), rect(600, 100, 720, 900)));
    const svg = renderGeometryStage(r, 'order');
    expect(svg).toContain('stroke-dasharray');
  });

  test('single-stroke glyph renders without a connector', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 520, 900)));
    const svg = renderGeometryStage(r, 'order');
    // Outline is drawn with plain strokes; only pen-travel lines are dashed gray.
    expect(svg).not.toContain('stroke="#999"');
  });
});

describe('reference stage', () => {
  test('without a reference the stage says so instead of rendering nothing', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 520, 900)));
    const svg = renderGeometryStage(r, 'reference');
    expect(svg).toContain('no reference data');
  });

  test('registered reference strokes render dashed with badges, counts, and attribution', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 520, 900)));
    r.reference = {
      source: 'kanjivg',
      license: 'KanjiVG © Ulrich Apel, CC BY-SA 3.0',
      transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
      strokes: [
        {
          points: [
            { x: 460, y: 120 },
            { x: 460, y: 880 },
          ],
        },
      ],
    };
    const svg = renderGeometryStage(r, 'reference');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('1 extracted / 1 reference');
    expect(svg).toContain('CC BY-SA');
    expect(svg).not.toContain('no reference data');
  });

  test('a count mismatch is flagged in red', () => {
    const r = run('I', commandsFromPolygons(rect(400, 100, 520, 900)));
    r.reference = {
      source: 'kanjivg',
      license: 'test',
      transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
      strokes: [
        {
          points: [
            { x: 460, y: 120 },
            { x: 460, y: 880 },
          ],
        },
        {
          points: [
            { x: 400, y: 500 },
            { x: 520, y: 500 },
          ],
        },
      ],
    };
    const svg = renderGeometryStage(r, 'reference');
    expect(svg).toContain('1 extracted / 2 reference');
    expect(svg).toContain('#c0392b');
  });
});
