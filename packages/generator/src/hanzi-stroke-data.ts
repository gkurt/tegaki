import type { BBox, Point, Stroke, TimedPoint } from 'tegaki';
import type { ParsedFontInfo, PipelineOptions, PipelineResult } from './commands/generate.ts';
import { extractGlyph } from './font/parse.ts';
import { toFontUnits } from './processing/font-units.ts';
import type { RasterResult } from './processing/rasterize.ts';

const HANZI_WRITER_DATA_BASE_URL = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest';
const HANZI_SOURCE_ADVANCE = 1024;
const HANZI_SOURCE_ASCENDER = 900;
const HANZI_SOURCE_DESCENDER = -124;
const HANZI_SOURCE_HEIGHT = HANZI_SOURCE_ASCENDER - HANZI_SOURCE_DESCENDER;
const HANZI_BASE_STROKE_WIDTH = 72;

const hanziDataCache = new Map<string, Promise<HanziWriterCharData | null>>();

export interface HanziWriterCharData {
  strokes: string[];
  medians: [x: number, y: number][][];
}

type HanziPipelineFontMetrics = Pick<ParsedFontInfo, 'ascender' | 'descender' | 'lineCap' | 'unitsPerEm'>;

export function isHanziCharacter(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0x2ceb0 && cp <= 0x2ebef) ||
    (cp >= 0x30000 && cp <= 0x3134f)
  );
}

export async function loadHanziWriterData(char: string): Promise<HanziWriterCharData | null> {
  if (!isHanziCharacter(char) || typeof fetch === 'undefined') return null;
  const cached = hanziDataCache.get(char);
  if (cached) return cached;

  const request = (async () => {
    const url = `${HANZI_WRITER_DATA_BASE_URL}/${encodeURIComponent(char)}.json`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<HanziWriterCharData>;
    if (!Array.isArray(json.strokes) || !Array.isArray(json.medians)) return null;
    return {
      strokes: json.strokes as string[],
      medians: json.medians as [number, number][][],
    };
  })().catch(() => null);

  hanziDataCache.set(char, request);
  return request;
}

export async function maybeBuildHanziPipelineResult(
  fontInfo: ParsedFontInfo,
  char: string,
  options: PipelineOptions,
): Promise<PipelineResult | null> {
  if (!isHanziCharacter(char)) return null;
  const glyph = extractGlyph(fontInfo.font, char, fontInfo.extraFonts);
  if (!glyph) return null;
  const data = await loadHanziWriterData(char);
  if (!data) return null;
  return buildHanziPipelineResult(fontInfo, char, glyph.advanceWidth, options, data);
}

export function buildHanziPipelineResult(
  fontInfo: HanziPipelineFontMetrics,
  char: string,
  advanceWidth: number,
  options: PipelineOptions,
  data: HanziWriterCharData,
): PipelineResult {
  const targetHeight = fontInfo.ascender - fontInfo.descender;
  const xScale = advanceWidth / HANZI_SOURCE_ADVANCE;
  const yScale = targetHeight / HANZI_SOURCE_HEIGHT;
  const defaultWidth = (advanceWidth / HANZI_SOURCE_ADVANCE) * HANZI_BASE_STROKE_WIDTH;

  const fontPolylines: Point[][] = data.medians.map((median) =>
    median.map(([x, y]) => ({
      x: round2(x * xScale),
      y: round2(-fontInfo.descender - (y - HANZI_SOURCE_DESCENDER) * yScale),
    })),
  );

  const bounds = computeBounds(fontPolylines, fontInfo.ascender, fontInfo.descender, advanceWidth);
  const maxDim = Math.max(bounds.x2 - bounds.x1, bounds.y2 - bounds.y1, 1);
  const scale = options.resolution / maxDim;
  const bitmapWidth = Math.max(1, Math.ceil((bounds.x2 - bounds.x1) * scale));
  const bitmapHeight = Math.max(1, Math.ceil((bounds.y2 - bounds.y1) * scale));
  const transform: RasterResult['transform'] = {
    scaleX: scale,
    scaleY: scale,
    offsetX: bounds.x1,
    offsetY: bounds.y1,
  };

  const localPolylines = fontPolylines.map((polyline) =>
    polyline.map((p) => ({ x: (p.x - bounds.x1) * scale, y: (p.y - bounds.y1) * scale })),
  );
  const strokes = localPolylines.map((polyline, order) => localPolylineToStroke(polyline, order, defaultWidth * scale));
  const strokesFontUnits = toFontUnits(strokes, transform, options.drawingSpeed, options.strokePause);
  const pathString = localPolylines
    .filter((polyline) => polyline.length > 0)
    .map((polyline) => polyline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round2(p.x)} ${round2(p.y)}`).join(' '))
    .join(' ');

  return {
    char,
    unicode: char.codePointAt(0) ?? 0,
    advanceWidth,
    boundingBox: bounds,
    pathString,
    lineCap: fontInfo.lineCap,
    ascender: fontInfo.ascender,
    descender: fontInfo.descender,
    subPaths: localPolylines,
    pathBBox: { x1: 0, y1: 0, x2: bitmapWidth, y2: bitmapHeight },
    bitmap: new Uint8Array(bitmapWidth * bitmapHeight),
    bitmapWidth,
    bitmapHeight,
    transform,
    skeleton: new Uint8Array(bitmapWidth * bitmapHeight),
    inverseDT: new Float32Array(bitmapWidth * bitmapHeight),
    polylines: localPolylines,
    strokes,
    strokesFontUnits,
    dataSource: 'hanzi-strokes',
  };
}

function localPolylineToStroke(polyline: Point[], order: number, width: number): Stroke {
  const totalLength = polylineLength(polyline);
  const safeWidth = round2(Math.max(width, 1));
  const points: TimedPoint[] = [];
  let traversed = 0;

  for (let i = 0; i < polyline.length; i++) {
    const point = polyline[i]!;
    if (i > 0) traversed += distance(polyline[i - 1]!, point);
    points.push({
      x: round2(point.x),
      y: round2(point.y),
      t: totalLength > 0 ? round3(traversed / totalLength) : 0,
      width: safeWidth,
    });
  }

  return {
    points,
    order,
    length: round2(totalLength),
    animationDuration: 0,
    delay: 0,
  };
}

function computeBounds(polylines: Point[][], ascender: number, descender: number, advanceWidth: number): BBox {
  let minX = advanceWidth;
  let minY = ascender;
  let maxX = 0;
  let maxY = descender;

  for (const polyline of polylines) {
    for (const point of polyline) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x1: 0, y1: descender, x2: advanceWidth, y2: ascender };
  }

  const padX = advanceWidth * 0.03;
  const padY = (ascender - descender) * 0.03;
  return {
    x1: round2(Math.max(0, minX - padX)),
    y1: round2(Math.max(descender, minY - padY)),
    x2: round2(Math.min(advanceWidth, maxX + padX)),
    y2: round2(Math.min(ascender, maxY + padY)),
  };
}

function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1]!, points[i]!);
  }
  return length;
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
