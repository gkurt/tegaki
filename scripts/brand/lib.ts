/**
 * Shared helpers for the logo and social card (scripts/generate-logo.ts,
 * scripts/generate-card.ts): both are composed from Tegaki's own stroke data
 * (the shipped bundles) and the fonts' real outlines, so the artwork is
 * literally written by the package.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type opentype from 'opentype.js';

// opentype.js is a generator dependency; resolve it from there.
const opentypeLib: typeof opentype = (
  await import(createRequire(resolve(import.meta.dir, '../../packages/generator/package.json')).resolve('opentype.js'))
).default;

export type Pt = [number, number, number];
export interface BundleStroke {
  p: Pt[];
  d: number;
  a: number;
}
export interface BundleGlyph {
  w: number;
  t: number;
  s: BundleStroke[];
}
export interface BundleLike {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  fontUrl: string;
  fullFontUrl?: string;
  glyphData: Record<string, BundleGlyph>;
}

export const PALETTE = {
  light: {
    paper: '#f4eee2',
    paperDeep: '#ebe3d3',
    card: '#fbf8f1',
    ink: '#1c1d2b',
    inkSoft: '#45443f',
    muted: '#6d6a63',
    rule: 'rgb(28 29 43 / 0.12)',
    seal: '#d33a26',
    gold: '#b8862f',
  },
  dark: {
    paper: '#11100e',
    paperDeep: '#0b0a09',
    card: '#1a1916',
    ink: '#f1e9da',
    inkSoft: '#cdc4b4',
    muted: '#958f84',
    rule: 'rgb(241 233 218 / 0.12)',
    seal: '#ff6a4d',
    gold: '#e8c27a',
  },
} as const;
export type Palette = (typeof PALETTE)[keyof typeof PALETTE];

export const f = (n: number) => (Math.round(n * 100) / 100).toString();

export function glyph(bundle: BundleLike, ch: string): BundleGlyph {
  const g = bundle.glyphData[ch];
  if (!g) throw new Error(`no glyph data for ${JSON.stringify(ch)}`);
  return g;
}

/** Median point width of a stroke — the pen width we draw it with. */
export function penWidth(s: BundleStroke): number {
  const ws = s.p.map((p) => p[2]).sort((a, b) => a - b);
  return ws[Math.floor(ws.length / 2)] ?? 40;
}

/**
 * Catmull-Rom spline through the stroke points as cubic béziers, offset by
 * (dx, dy) and scaled by k. Compact and smooth; the pen width is a native
 * SVG stroke so it animates with a plain dash offset.
 */
export function strokePath(pts: readonly Pt[], k = 1, dx = 0, dy = 0): string {
  const P = pts.map(([x, y]) => [x * k + dx, y * k + dy] as const);
  if (P.length === 1) {
    const [x, y] = P[0]!;
    return `M${f(x)} ${f(y)}l0.01 0`;
  }
  let d = `M${f(P[0]![0])} ${f(P[0]![1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]!;
    const p1 = P[i]!;
    const p2 = P[i + 1]!;
    const p3 = P[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0]!)} ${f(c1[1]!)} ${f(c2[0]!)} ${f(c2[1]!)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** A stroke's spline arc length, in the units of its points × k. */
export function strokeLength(pts: readonly Pt[], k = 1): number {
  let len = 0;
  let prev = pointAt(pts, 0);
  for (let i = 1; i <= 64; i++) {
    const p = pointAt(pts, i / 64);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len * k;
}

/** Point at fraction `t` of a stroke's (spline-sampled) arc length. */
export function pointAt(pts: readonly Pt[], t: number): [number, number] {
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    for (let s = 0; s < 24; s++) {
      const u = s / 24;
      const cr = (a: number, b: number, c: number, e: number) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u * u + (-a + 3 * b - 3 * c + e) * u * u * u);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts.at(-1)!;
  dense.push([last[0], last[1]]);
  const lens = [0];
  for (let i = 1; i < dense.length; i++)
    lens.push(lens[i - 1]! + Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]));
  const target = lens.at(-1)! * t;
  for (let i = 1; i < dense.length; i++) {
    if (lens[i]! >= target) {
      const a = dense[i - 1]!;
      const b = dense[i]!;
      const u = (target - lens[i - 1]!) / (lens[i]! - lens[i - 1]! || 1);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    }
  }
  return dense.at(-1)!;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Transform that fits `box` centered into a square/rect of (w, h) with `margin`. */
export function fit(box: BBox, w: number, h: number, margin: number, cx = w / 2, cy = h / 2) {
  const k = Math.min((w - 2 * margin) / (box.x1 - box.x0), (h - 2 * margin) / (box.y1 - box.y0));
  const dx = cx - ((box.x0 + box.x1) / 2) * k;
  const dy = cy - ((box.y0 + box.y1) / 2) * k;
  return { k, dx, dy };
}

export interface DrawOpts {
  k: number;
  dx: number;
  dy: number;
  color: string;
  /** Pen width multiplier (the geometry bundles are drawn ×1.2 in the renderer). */
  weight?: number;
  /** Per-stroke color / progress overrides. */
  strokeColor?: (i: number) => string | undefined;
  progress?: (i: number) => number;
  /** Extra attributes on every stroke path. */
  attrs?: (i: number) => string;
}

/** A glyph's strokes as round-capped SVG paths. */
export function drawStrokes(strokes: readonly BundleStroke[], o: DrawOpts): string {
  return strokes
    .map((s, i) => {
      const t = o.progress?.(i) ?? 1;
      if (t <= 0) return '';
      const w = penWidth(s) * (o.weight ?? 1.2) * o.k;
      const dash = t < 1 ? ` pathLength="1" stroke-dasharray="${f(t)} 2"` : '';
      return `<path d="${strokePath(s.p, o.k, o.dx, o.dy)}" stroke="${o.strokeColor?.(i) ?? o.color}" stroke-width="${f(w)}"${dash}${o.attrs?.(i) ?? ''}/>`;
    })
    .join('');
}

export const STROKE_GROUP = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';

// ---------------------------------------------------------------- fonts

const fontCache = new Map<string, opentype.Font>();

export async function loadFont(path: string): Promise<opentype.Font> {
  let font = fontCache.get(path);
  if (!font) {
    font = opentypeLib.parse(await Bun.file(path).arrayBuffer());
    fontCache.set(path, font);
  }
  return font;
}

/** Download a Google Fonts TTF for a css2 `family=` query (e.g. `Instrument+Serif:ital@1`). */
export async function googleTtf(query: string, slug: string): Promise<string> {
  const path = resolve(import.meta.dir, '../../.cache/fonts', `brand-${slug}.ttf`);
  if (await Bun.file(path).exists()) return path;
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { headers: { 'User-Agent': 'tegaki/1.0' } })).text();
  const url = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`no ttf for ${query}: ${css.slice(0, 200)}`);
  await Bun.write(path, await (await fetch(url)).arrayBuffer());
  return path;
}

/** Path commands as SVG path data (opentype's own toPathData emits NaN at some scales). */
function pathData(path: opentype.Path): string {
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'Z') d += 'Z';
    else if (c.type === 'M' || c.type === 'L') d += `${c.type}${f(c.x)} ${f(c.y)}`;
    else if (c.type === 'Q') d += `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
    else if (c.type === 'C') d += `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
  }
  return d;
}

/** Glyph-by-glyph layout with pair kerning (opentype's run shaper trips on some fonts' GSUB lookups). */
function layoutRun(font: opentype.Font, text: string, size: number, tracking: number): { glyph: opentype.Glyph; x: number }[] {
  const scale = size / font.unitsPerEm;
  const out: { glyph: opentype.Glyph; x: number }[] = [];
  let pen = 0;
  let prev: opentype.Glyph | null = null;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) pen += font.getKerningValue(prev, g) * scale + tracking;
    out.push({ glyph: g, x: pen });
    pen += (g.advanceWidth ?? 0) * scale;
    prev = g;
  }
  return out;
}

/** Text as outline path data, baseline at (x, y). */
export function textPath(font: opentype.Font, text: string, x: number, y: number, size: number, tracking = 0): string {
  return layoutRun(font, text, size, tracking)
    .map(({ glyph: g, x: gx }) => pathData(g.getPath(x + gx, y, size)))
    .join('');
}

export function textWidth(font: opentype.Font, text: string, size: number, tracking = 0): number {
  const run = layoutRun(font, text, size, tracking);
  const last = run.at(-1);
  return last ? last.x + ((last.glyph.advanceWidth ?? 0) * size) / font.unitsPerEm : 0;
}

/** A glyph's real outline from the font, in the bundle's coordinate space (baseline 0, y down, 1 unit = 1 font unit). */
export function glyphOutline(font: opentype.Font, ch: string, k = 1, dx = 0, dy = 0): string {
  const upm = font.unitsPerEm;
  return pathData(font.charToGlyph(ch).getPath(dx, dy, upm * k));
}

export function svg(w: number, h: number, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>${body}</svg>\n`;
}
