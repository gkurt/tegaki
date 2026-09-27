// A variable font that writes itself: each glyph's strokes as outlines, and a
// `PROG` axis (0–100, the share of the glyph's own drawing time) along which
// they grow in the order and at the pace Tegaki draws them. The default
// instance is the written glyph, so software without variations shows the
// finished text; animating `font-variation-settings` from 0 to 100 writes it.
//
// Every segment of a stroke is its own four-point contour whose far edge grows
// out of its near edge while the pen crosses it — two tent regions per
// segment (hold collapsed, then ramp), so the size is linear in the points.
// Dots, round caps and sharp joins are small discs grown from their centre.
//
// Given the font the strokes came from, it keeps that font's glyph ids,
// advances and cmap and copies its GSUB / GPOS / GDEF as they are (they only
// name glyph ids), so it shapes like the source: ligatures, alternates,
// positional forms, marks and kerning.

import type { TegakiGlyphData } from 'tegaki';

export const PROGRESS_AXIS_TAG = 'PROG';

export interface ProgressFontInput {
  /** Family name the font is installed / registered under. */
  family: string;
  unitsPerEm: number;
  ascender: number;
  /** Negative, below the baseline. */
  descender: number;
  /** Glyphs by character, as in a bundle's `glyphData` (y down from the baseline). */
  glyphData: Record<string, TegakiGlyphData>;
  lineCap?: 'round' | 'butt' | 'square';
  /** Advance of the space, in font units, when there is no `source`. Default: a quarter em. */
  spaceAdvance?: number;
  /** Each stroke's draw progress easing, baked into when the pen reaches each point. Default: ease-out quad (the renderer's). */
  strokeEasing?: (t: number) => number;
  /**
   * The TrueType / OpenType file the glyph data was generated from — a
   * bundle's font (its primary subset). The font then keeps its glyph ids,
   * advances and cmap, and its GSUB / GPOS / GDEF, so it shapes as the source
   * does. Characters of `glyphData` the source doesn't map are added after
   * its glyphs, unshaped.
   */
  source?: Uint8Array | ArrayBuffer;
  /** Glyphs by id in `source`, as in a bundle's `glyphDataById` (keys of other subsets, `"1:42"`, are skipped). */
  glyphDataById?: Record<string, TegakiGlyphData>;
}

export interface ProgressFont {
  /** The font file (TrueType, `glyf` + `fvar` + `gvar`). */
  buffer: Uint8Array<ArrayBuffer>;
  /** Characters the cmap maps to a glyph with outlines, in code point order. */
  chars: string[];
  /** Glyphs with outlines, variants (alternates, ligatures, positional forms) included. */
  glyphs: number;
  /** Layout tables copied from `source` — none without one, or when it is itself a variable font. */
  layout: string[];
}

/** Most tuples a glyph's variation data can hold (`tupleVariationCount` has 12 bits). */
const MAX_TUPLES = 0x0fff;
/** One F2DOT14 step. */
const STEP = 1 / 16384;
/** Turns sharper than this get a disc at the joint, so the segments' mitred ends don't pinch. */
const JOIN_ANGLE = (25 * Math.PI) / 180;

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

// --- Outlines ---------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
  on: boolean;
}

/** A contour and how it grows: each point from `from[i]` to its place, over `[t0, t1]` glyph seconds. */
interface Growing {
  points: Pt[];
  from: { x: number; y: number }[];
  t0: number;
  t1: number;
}

interface GlyphOutline {
  contours: Growing[];
  /** Seconds the axis spans: the glyph's `t`, or its last stroke's end if later. */
  duration: number;
}

const round = (v: number) => Math.round(v);

/** A circle of radius `r` as eight off-curve points (the on-curve ones between them are implied), grown from its centre. */
function disc(cx: number, cy: number, r: number, t0: number, t1: number): Growing {
  const k = r / Math.cos(Math.PI / 8);
  const points: Pt[] = [];
  // Clockwise in y-up font space, like the segments' contours.
  for (let i = 0; i < 8; i++) {
    const a = -(i * Math.PI) / 4;
    points.push({ x: round(cx + k * Math.cos(a)), y: round(cy + k * Math.sin(a)), on: false });
  }
  return { points, from: points.map(() => ({ x: round(cx), y: round(cy) })), t0, t1 };
}

/** A square of side `2r`, grown from its centre (a dot with a butt or square cap). */
function square(cx: number, cy: number, r: number, t0: number, t1: number): Growing {
  const corners: [number, number][] = [
    [-r, -r],
    [-r, r],
    [r, r],
    [r, -r],
  ];
  const points = corners.map(([dx, dy]) => ({ x: round(cx + dx), y: round(cy + dy), on: true }));
  return { points, from: points.map(() => ({ x: round(cx), y: round(cy) })), t0, t1 };
}

/** Where linear stroke time `x` gives eased progress `u`: the inverse of a monotonic easing, by bisection. */
function inverseEasing(ease: (t: number) => number, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Seconds a glyph's `PROG` axis spans from 0 to 100: its `t`, or its last stroke's end if later. */
export function progressDuration(glyph: TegakiGlyphData): number {
  let duration = glyph.t;
  for (const stroke of glyph.s) duration = Math.max(duration, stroke.d + stroke.a);
  return duration > 0 ? duration : 1;
}

/** The `PROG` value that draws `glyph` as it is `seconds` into its own drawing. */
export function progressAt(glyph: TegakiGlyphData, seconds: number): number {
  return Math.min(Math.max(seconds / progressDuration(glyph), 0), 1) * 100;
}

/** A glyph's strokes as growing contours, in font units (y up). */
export function glyphOutline(glyph: TegakiGlyphData, lineCap: ProgressFontInput['lineCap'], ease: (t: number) => number): GlyphOutline {
  const contours: Growing[] = [];
  const duration = progressDuration(glyph);

  for (const stroke of glyph.s) {
    // Font space is y up; the bundle's points are y down from the baseline.
    const q: { x: number; y: number; w: number }[] = [];
    for (const p of stroke.p) {
      const pt = { x: p[0]!, y: -p[1]!, w: p[2]! };
      const last = q[q.length - 1];
      if (!last || last.x !== pt.x || last.y !== pt.y) q.push(pt);
    }
    if (q.length === 0) continue;
    const start = stroke.d;
    const end = stroke.d + stroke.a;
    if (q.length === 1) {
      const dot = q[0]!;
      contours.push(
        lineCap === 'round' || !lineCap ? disc(dot.x, dot.y, dot.w / 2, start, end) : square(dot.x, dot.y, dot.w / 2, start, end),
      );
      continue;
    }

    const n = q.length;
    // When the pen reaches each point: its share of the length, through the easing.
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y));
    const total = cum[n - 1]!;
    const time = cum.map((c) => start + stroke.a * inverseEasing(ease, c / total));

    // Square caps reach half the width past each end.
    if (lineCap === 'square') {
      const extend = (i: number, j: number) => {
        const dx = q[i]!.x - q[j]!.x;
        const dy = q[i]!.y - q[j]!.y;
        const len = Math.hypot(dx, dy) || 1;
        q[i] = { ...q[i]!, x: q[i]!.x + (dx / len) * (q[i]!.w / 2), y: q[i]!.y + (dy / len) * (q[i]!.w / 2) };
      };
      extend(0, 1);
      extend(n - 1, n - 2);
    }

    // Each point's two edges: half the width either side of the averaged tangent.
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = q[Math.max(0, i - 1)]!;
      const b = q[Math.min(n - 1, i + 1)]!;
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const h = q[i]!.w / 2;
      left.push({ x: round(q[i]!.x - ty * h), y: round(q[i]!.y + tx * h) });
      right.push({ x: round(q[i]!.x + ty * h), y: round(q[i]!.y - tx * h) });
    }

    for (let i = 0; i < n - 1; i++) {
      // Near edge in place; the far edge starts on it. Forward along the left, back along the
      // right: clockwise in y-up space, like the discs, so overlaps add up instead of cancelling.
      const points: Pt[] = [
        { ...left[i]!, on: true },
        { ...left[i + 1]!, on: true },
        { ...right[i + 1]!, on: true },
        { ...right[i]!, on: true },
      ];
      contours.push({ points, from: [left[i]!, left[i]!, right[i]!, right[i]!], t0: time[i]!, t1: time[i + 1]! });
    }

    // Round joins where the line turns sharply, grown as the segment after them draws.
    for (let i = 1; i < n - 1; i++) {
      const ax = q[i]!.x - q[i - 1]!.x;
      const ay = q[i]!.y - q[i - 1]!.y;
      const bx = q[i + 1]!.x - q[i]!.x;
      const by = q[i + 1]!.y - q[i]!.y;
      const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
      if (turn > JOIN_ANGLE) contours.push(disc(q[i]!.x, q[i]!.y, q[i]!.w / 2, time[i]!, time[i + 1]!));
    }

    if (lineCap === 'round' || !lineCap) {
      contours.push(disc(q[0]!.x, q[0]!.y, q[0]!.w / 2, time[0]!, time[1]!));
      contours.push(disc(q[n - 1]!.x, q[n - 1]!.y, q[n - 1]!.w / 2, time[n - 2]!, time[n - 1]!));
    }
  }
  return { contours, duration };
}

// --- Variations -------------------------------------------------------------

/** Glyph seconds as a normalized axis coordinate: 0 s is -1, the glyph's end is 0 (the default, written). */
function normalized(t: number, duration: number): number {
  const v = Math.min(Math.max(t / duration, 0), 1) - 1;
  return Math.round(v / STEP) * STEP;
}

interface Tuple {
  start: number;
  peak: number;
  end: number;
  /** Point index → delta. */
  deltas: Map<number, [number, number]>;
}

/**
 * The glyph's tuples: for each contour, the tents that hold its points at
 * `from` until `t0`, then ramp them to their place by `t1`. Contours whose
 * windows share a region share its tuple. Every point of a contour a tuple
 * touches is listed, zeros included, so interpolation of untouched points
 * never moves them.
 */
export function glyphTuples(outline: GlyphOutline): Tuple[] {
  const tuples = new Map<string, Tuple>();
  const add = (start: number, peak: number, end: number, base: number, deltas: [number, number][]) => {
    const key = `${start},${peak},${end}`;
    let tuple = tuples.get(key);
    if (!tuple) tuples.set(key, (tuple = { start, peak, end, deltas: new Map() }));
    for (let i = 0; i < deltas.length; i++) tuple.deltas.set(base + i, deltas[i]!);
  };
  let base = 0;
  for (const c of outline.contours) {
    const deltas = c.points.map((p, i): [number, number] => [c.from[i]!.x - p.x, c.from[i]!.y - p.y]);
    if (deltas.some(([dx, dy]) => dx !== 0 || dy !== 0)) {
      // A window at the very end still needs room to ramp, and a peak of 0 would switch the axis off.
      let n0 = Math.min(normalized(c.t0, outline.duration), -STEP);
      const n1 = Math.min(Math.max(normalized(c.t1, outline.duration), n0 + STEP), 0);
      if (n1 <= n0) n0 = n1 - STEP;
      if (n0 <= -1) add(-1, -1, n1, base, deltas);
      else {
        add(-1, -1, n0, base, deltas);
        add(-1, n0, n1, base, deltas);
      }
    }
    base += c.points.length;
  }
  return [...tuples.values()];
}

// --- Binary writing ---------------------------------------------------------

class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
    return this;
  }
  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
    return this;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.length, v);
    this.length += 2;
    return this;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.length, v);
    this.length += 2;
    return this;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0);
    this.length += 4;
    return this;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.length, v);
    this.length += 4;
    return this;
  }
  /** 16.16 fixed. */
  fixed(v: number) {
    return this.i32(Math.round(v * 65536));
  }
  f2dot14(v: number) {
    return this.i16(Math.round(v * 16384));
  }
  tag(t: string) {
    for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i) || 32);
    return this;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }
  pad(align = 4) {
    while (this.length % align) this.u8(0);
    return this;
  }
  setU32(at: number, v: number) {
    this.view.setUint32(at, v >>> 0);
  }
  data(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.length);
  }
}

/** `gvar` packed point numbers: a count, then runs of byte or word gaps from the previous point. */
function packPoints(w: Writer, points: number[]) {
  const n = points.length;
  if (n < 128) w.u8(n);
  else w.u8(0x80 | (n >> 8)).u8(n & 0xff);
  let prev = 0;
  for (let i = 0; i < n; ) {
    const run = Math.min(128, n - i);
    let words = false;
    for (let j = i, p = prev; j < i + run; p = points[j]!, j++) if (points[j]! - p > 255) words = true;
    w.u8((words ? 0x80 : 0) | (run - 1));
    for (let j = i; j < i + run; j++) {
      const gap = points[j]! - prev;
      if (words) w.u16(gap);
      else w.u8(gap);
      prev = points[j]!;
    }
    i += run;
  }
}

/** `gvar` packed deltas: runs of zeros, bytes or words, at most 64 each. */
function packDeltas(w: Writer, values: number[]) {
  const kind = (v: number) => (v === 0 ? 0 : v >= -128 && v <= 127 ? 1 : 2);
  for (let i = 0; i < values.length; ) {
    const k = kind(values[i]!);
    let run = 1;
    while (i + run < values.length && run < 64 && kind(values[i + run]!) === k) run++;
    w.u8((k === 0 ? 0x80 : k === 2 ? 0x40 : 0) | (run - 1));
    for (let j = i; j < i + run; j++) {
      if (k === 1) w.i8(values[j]!);
      else if (k === 2) w.i16(values[j]!);
    }
    i += run;
  }
}

interface EncodedGlyph {
  glyf: Uint8Array;
  gvar: Uint8Array;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  points: number;
  contours: number;
  advance: number;
}

function encodeGlyph(outline: GlyphOutline | null, advance: number): EncodedGlyph {
  const empty = { glyf: new Uint8Array(0), gvar: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0, advance };
  if (!outline || outline.contours.length === 0) return empty;
  const pts = outline.contours.flatMap((c) => c.points);
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of pts) {
    xMin = Math.min(xMin, p.x);
    yMin = Math.min(yMin, p.y);
    xMax = Math.max(xMax, p.x);
    yMax = Math.max(yMax, p.y);
  }

  // glyf: header, contour ends, no instructions, flags (with repeats), then x and y deltas.
  const g = new Writer();
  g.i16(outline.contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  let endPt = -1;
  for (const c of outline.contours) g.u16((endPt += c.points.length));
  g.u16(0);
  const flags: number[] = [];
  const xs = new Writer();
  const ys = new Writer();
  let px = 0;
  let py = 0;
  pts.forEach((p, i) => {
    let f = p.on ? 0x01 : 0;
    if (i === 0) f |= 0x40; // OVERLAP_SIMPLE: contours overlap on purpose
    const dx = p.x - px;
    const dy = p.y - py;
    px = p.x;
    py = p.y;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) <= 255) {
      f |= 0x02 | (dx > 0 ? 0x10 : 0);
      xs.u8(Math.abs(dx));
    } else xs.i16(dx);
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) <= 255) {
      f |= 0x04 | (dy > 0 ? 0x20 : 0);
      ys.u8(Math.abs(dy));
    } else ys.i16(dy);
    flags.push(f);
  });
  for (let i = 0; i < flags.length; ) {
    let run = 1;
    while (i + run < flags.length && run < 256 && flags[i + run] === flags[i]) run++;
    if (run > 1) g.u8(flags[i]! | 0x08).u8(run - 1);
    else g.u8(flags[i]!);
    i += run;
  }
  g.bytes(xs.data()).bytes(ys.data()).pad(2);

  // gvar: tuple headers with embedded peaks and intermediate regions, then each tuple's points and deltas.
  const tuples = glyphTuples(outline);
  if (tuples.length > MAX_TUPLES) throw new Error(`A glyph needs ${tuples.length} variation tuples (at most ${MAX_TUPLES})`);
  const serialized = tuples.map((t) => {
    const w = new Writer();
    const indices = [...t.deltas.keys()].sort((a, b) => a - b);
    packPoints(w, indices);
    packDeltas(
      w,
      indices.map((i) => t.deltas.get(i)![0]),
    );
    packDeltas(
      w,
      indices.map((i) => t.deltas.get(i)![1]),
    );
    return w.data();
  });
  const v = new Writer();
  v.u16(tuples.length).u16(4 + tuples.length * 10);
  tuples.forEach((t, i) => {
    v.u16(serialized[i]!.length).u16(0x8000 | 0x4000 | 0x2000);
    v.f2dot14(t.peak).f2dot14(t.start).f2dot14(t.end);
  });
  for (const s of serialized) v.bytes(s);
  v.pad(2);

  return { glyf: g.data(), gvar: v.data(), xMin, yMin, xMax, yMax, points: pts.length, contours: outline.contours.length, advance };
}

// --- Tables -------------------------------------------------------------------

function nameTable(family: string): Uint8Array {
  const ps = family.replace(/[^A-Za-z0-9-]/g, '').slice(0, 63) || 'TegakiProgress';
  const names: [number, string][] = [
    [1, family],
    [2, 'Regular'],
    [3, `${family};Tegaki progress`],
    [4, family],
    [5, 'Version 1.000'],
    [6, ps],
    [256, 'Progress'],
  ];
  const strings = new Writer();
  const w = new Writer();
  w.u16(0)
    .u16(names.length)
    .u16(6 + names.length * 12);
  for (const [id, text] of names) {
    const start = strings.length;
    for (let i = 0; i < text.length; i++) strings.u16(text.charCodeAt(i));
    w.u16(3)
      .u16(1)
      .u16(0x0409)
      .u16(id)
      .u16(strings.length - start)
      .u16(start);
  }
  return w.bytes(strings.data()).data();
}

/** cmap with a format 4 (BMP) and a format 12 subtable, over runs of consecutive code points with consecutive glyph ids. */
function cmapTable(mapping: [cp: number, gid: number][]): Uint8Array {
  // Sorted by code point.
  const runs: { start: number; end: number; gid: number }[] = [];
  for (const [cp, gid] of mapping) {
    const last = runs[runs.length - 1];
    if (last && cp === last.end + 1 && gid === last.gid + (cp - last.start)) last.end = cp;
    else runs.push({ start: cp, end: cp, gid });
  }

  const bmp = runs.filter((r) => r.start <= 0xfffe).map((r) => ({ ...r, end: Math.min(r.end, 0xfffe) }));
  const segs = [...bmp, { start: 0xffff, end: 0xffff, gid: 0 }];
  const segCount = segs.length;
  const entrySelector = Math.floor(Math.log2(segCount));
  const searchRange = 2 * 2 ** entrySelector;
  const f4 = new Writer();
  f4.u16(4)
    .u16(16 + segCount * 8)
    .u16(0);
  f4.u16(segCount * 2)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(segCount * 2 - searchRange);
  for (const s of segs) f4.u16(s.end);
  f4.u16(0);
  for (const s of segs) f4.u16(s.start);
  for (const s of segs) f4.u16(s.start === 0xffff ? 1 : (s.gid - s.start) & 0xffff);
  for (const _ of segs) f4.u16(0);

  const f12 = new Writer();
  f12
    .u16(12)
    .u16(0)
    .u32(16 + runs.length * 12)
    .u32(0)
    .u32(runs.length);
  for (const r of runs) f12.u32(r.start).u32(r.end).u32(r.gid);

  const w = new Writer();
  const f4Data = f4.data();
  w.u16(0).u16(2);
  w.u16(3)
    .u16(1)
    .u32(4 + 16);
  w.u16(3)
    .u16(10)
    .u32(4 + 16 + f4Data.length);
  return w.bytes(f4Data).bytes(f12.data()).data();
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
  padded.set(data);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

/** Tables into an sfnt, tags sorted, each 4-byte aligned, with `head`'s checksum adjustment filled in. */
function assemble(tables: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 16 * 2 ** entrySelector;
  const w = new Writer();
  w.u32(0x00010000)
    .u16(numTables)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(numTables * 16 - searchRange);
  let offset = 12 + numTables * 16;
  for (const tag of tags) {
    const data = tables[tag]!;
    w.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  let headOffset = 0;
  for (const tag of tags) {
    if (tag === 'head') headOffset = w.length;
    w.bytes(tables[tag]!).pad(4);
  }
  w.setU32(headOffset + 8, (0xb1b0afba - checksum(w.data())) >>> 0);
  return w.data();
}

// --- Reading the source font ------------------------------------------------

/** ZWNJ and ZWJ, mapped in every font made from a source. */
const JOINERS = [0x200c, 0x200d];

/** Tables copied from the source as they are: they refer to glyphs only by id. */
const LAYOUT_TABLES = ['GDEF', 'GPOS', 'GSUB'] as const;

interface SourceFont {
  numGlyphs: number;
  /** Advance per glyph id. */
  advances: number[];
  /** Code point → glyph id. */
  cmap: Map<number, number>;
  /** Glyph ids whose outline is empty (known for `glyf` fonts only; spaces and invisible characters are mapped regardless). */
  blank: Set<number> | null;
  layout: Partial<Record<(typeof LAYOUT_TABLES)[number], Uint8Array>>;
  variable: boolean;
}

/** The parts of a TrueType / OpenType file the progress font takes from it. */
export function readSourceFont(file: Uint8Array | ArrayBuffer): SourceFont {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    throw new Error('The source must be a TrueType or OpenType font file (not a collection, WOFF or WOFF2)');
  }
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0, n = view.getUint16(4); i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    tables.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const table = (tag: string) => {
    const t = tables.get(tag);
    if (!t) throw new Error(`The source font has no ${tag} table`);
    return t;
  };

  const numGlyphs = view.getUint16(table('maxp').offset + 4);
  const numberOfHMetrics = view.getUint16(table('hhea').offset + 34);
  const hmtx = table('hmtx').offset;
  const advances: number[] = [];
  for (let gid = 0; gid < numGlyphs; gid++) advances.push(view.getUint16(hmtx + 4 * Math.min(gid, numberOfHMetrics - 1)));

  // Unicode subtables: format 4 (BMP) first, so a format 12 fills in the rest and wins.
  const cmap = new Map<number, number>();
  const cmapAt = table('cmap').offset;
  const subtables: { offset: number; format: number }[] = [];
  for (let i = 0, n = view.getUint16(cmapAt + 2); i < n; i++) {
    const platform = view.getUint16(cmapAt + 4 + i * 8);
    const encoding = view.getUint16(cmapAt + 6 + i * 8);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmapAt + view.getUint32(cmapAt + 8 + i * 8);
    subtables.push({ offset, format: view.getUint16(offset) });
  }
  for (const { offset, format } of subtables.sort((a, b) => a.format - b.format)) {
    if (format === 4) {
      const segX2 = view.getUint16(offset + 6);
      const ends = offset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = view.getUint16(ends + s);
        const start = view.getUint16(starts + s);
        const delta = view.getInt16(deltas + s);
        const rangeOffset = view.getUint16(rangeOffsets + s);
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          let gid: number;
          if (rangeOffset === 0) gid = (cp + delta) & 0xffff;
          else {
            const g = view.getUint16(rangeOffsets + s + rangeOffset + 2 * (cp - start));
            gid = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (gid !== 0 && gid < numGlyphs) cmap.set(cp, gid);
        }
      }
    } else if (format === 12) {
      for (let i = 0, n = view.getUint32(offset + 12); i < n; i++) {
        const at = offset + 16 + i * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        const gid = view.getUint32(at + 8);
        for (let cp = start; cp <= end; cp++) if (gid + (cp - start) < numGlyphs) cmap.set(cp, gid + (cp - start));
      }
    }
  }

  let blank: Set<number> | null = null;
  const loca = tables.get('loca');
  if (tables.has('glyf') && loca) {
    const long = view.getInt16(table('head').offset + 50) === 1;
    const at = (gid: number) => (long ? view.getUint32(loca.offset + 4 * gid) : view.getUint16(loca.offset + 2 * gid) * 2);
    blank = new Set();
    for (let gid = 0; gid < numGlyphs; gid++) if (at(gid + 1) === at(gid)) blank.add(gid);
  }

  const layout: SourceFont['layout'] = {};
  for (const tag of LAYOUT_TABLES) {
    const t = tables.get(tag);
    if (t) layout[tag] = bytes.slice(t.offset, t.offset + t.length);
  }
  return { numGlyphs, advances, cmap, blank, layout, variable: tables.has('fvar') };
}

/**
 * The usual hollow box for .notdef, the same at every axis value. It also
 * keeps `glyf` from being empty when no character has ink, which browsers
 * reject.
 */
function notdefOutline(advance: number, ascender: number): GlyphOutline {
  const x0 = round(advance * 0.1);
  const x1 = Math.max(x0 + 4, round(advance * 0.9));
  const y1 = Math.max(4, round(ascender * 0.7));
  const t = Math.max(1, round((x1 - x0) / 10));
  const box = (a: number, b: number, c: number, d: number, reverse: boolean): Growing => {
    const corners: [number, number][] = [
      [a, b],
      [a, d],
      [c, d],
      [c, b],
    ];
    const points = (reverse ? corners.reverse() : corners).map(([x, y]) => ({ x, y, on: true }));
    return { points, from: points.map(({ x, y }) => ({ x, y })), t0: 0, t1: 0 };
  };
  // Clockwise outside and counter-clockwise inside (y up): a frame.
  return { contours: [box(x0, 0, x1, y1, false), box(x0 + t, t, x1 - t, y1 - t, true)], duration: 1 };
}

/** A glyph to build: its strokes (none for a blank glyph) and its advance. */
interface GlyphSlot {
  data: TegakiGlyphData | null;
  advance: number;
}

/** Glyph ids from 0 (.notdef), the cmap, and the layout tables of the font to build. */
function glyphSet(input: ProgressFontInput): { slots: GlyphSlot[]; cmap: [number, number][]; layout: Record<string, Uint8Array> } {
  const single = Object.keys(input.glyphData)
    .filter((c) => [...c].length === 1)
    .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);

  if (!input.source) {
    const spaceAdvance = round(input.spaceAdvance ?? input.unitsPerEm / 4);
    const chars = [...new Set([' ', ...single])].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
    const slots: GlyphSlot[] = [{ data: null, advance: round(input.unitsPerEm / 2) }];
    for (const c of chars) {
      const data = c === ' ' ? null : input.glyphData[c]!;
      slots.push({ data, advance: data ? round(data.w) : spaceAdvance });
    }
    return { slots, cmap: chars.map((c, i) => [c.codePointAt(0)!, i + 1]), layout: {} };
  }

  const source = readSourceFont(input.source);
  const charOf = new Map<number, string>();
  for (const [cp, gid] of [...source.cmap].sort((a, b) => a[0] - b[0])) if (!charOf.has(gid)) charOf.set(gid, String.fromCodePoint(cp));
  const slots: GlyphSlot[] = source.advances.map((advance, gid) => {
    const byChar = charOf.get(gid);
    const data =
      (gid === 0 ? undefined : input.glyphDataById?.[String(gid)]) ?? (byChar === undefined ? undefined : input.glyphData[byChar]);
    return { data: data ?? null, advance };
  });

  // Mapped: characters drawn here, ones the source leaves blank, and spaces and invisible
  // characters (ZWJ, ZWNJ, direction marks — some fonts give them an outline, which isn't
  // drawn). Browsers put joiners around Arabic split across styles, and one taken from another
  // font breaks the run. Any other character is left out, so the browser draws it from a
  // fallback font rather than as nothing.
  const cmap: [number, number][] = [];
  for (const [cp, gid] of source.cmap) {
    const char = String.fromCodePoint(cp);
    const invisible = /[\s\p{Default_Ignorable_Code_Point}]/u.test(char);
    if (slots[gid]!.data || input.glyphData[char] || source.blank?.has(gid) || invisible) cmap.push([cp, gid]);
  }
  // Characters the source doesn't map get glyphs of their own after its glyphs, unshaped.
  for (const c of single) {
    const cp = c.codePointAt(0)!;
    if (source.cmap.has(cp)) continue;
    cmap.push([cp, slots.length]);
    slots.push({ data: input.glyphData[c]!, advance: round(input.glyphData[c]!.w) });
  }
  // A subset often lacks the joiners: an empty, zero-width glyph for them.
  for (const cp of JOINERS) {
    if (source.cmap.has(cp)) continue;
    cmap.push([cp, slots.length]);
    slots.push({ data: null, advance: 0 });
  }
  cmap.sort((a, b) => a[0] - b[0]);
  // A variable source's GDEF / GPOS / GSUB can hold variation data for its own axes, which would read ours.
  return { slots, cmap, layout: source.variable ? {} : source.layout };
}

/**
 * Build the self-writing variable font for `input.glyphData` (and, with a
 * `source`, `input.glyphDataById` and the source's layout tables). Without a
 * source it has the single code point characters plus a space, no GSUB / GPOS.
 */
export function buildProgressFont(input: ProgressFontInput): ProgressFont {
  const { unitsPerEm, ascender, descender, lineCap = 'round' } = input;
  const ease = input.strokeEasing ?? easeOutQuad;

  const set = glyphSet(input);
  if (set.slots.length > 0xffff) throw new Error(`The font needs ${set.slots.length} glyphs (at most 65535)`);
  const glyphs = set.slots.map((s, gid) =>
    encodeGlyph(gid === 0 ? notdefOutline(s.advance, ascender) : s.data ? glyphOutline(s.data, lineCap, ease) : null, s.advance),
  );
  const numGlyphs = glyphs.length;
  const inked = glyphs.filter((g) => g.contours > 0);
  // Loops, not spreads: a source font can have more glyphs than a call takes arguments.
  const least = (values: number[]) => values.reduce((a, b) => Math.min(a, b), Infinity);
  const most = (values: number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity);
  const bbox = inked.length
    ? {
        xMin: least(inked.map((g) => g.xMin)),
        yMin: least(inked.map((g) => g.yMin)),
        xMax: most(inked.map((g) => g.xMax)),
        yMax: most(inked.map((g) => g.yMax)),
      }
    : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

  // glyf + loca (long offsets).
  const glyf = new Writer();
  const loca = new Writer();
  for (const g of glyphs) {
    loca.u32(glyf.length);
    glyf.bytes(g.glyf);
  }
  loca.u32(glyf.length);

  // gvar: one axis, no shared tuples, long offsets.
  const gvarData = new Writer();
  const gvarOffsets: number[] = [];
  for (const g of glyphs) {
    gvarOffsets.push(gvarData.length);
    gvarData.bytes(g.gvar);
  }
  gvarOffsets.push(gvarData.length);
  const gvar = new Writer();
  const gvarHeader = 20 + (numGlyphs + 1) * 4;
  gvar.u16(1).u16(0).u16(1).u16(0).u32(gvarHeader).u16(numGlyphs).u16(1).u32(gvarHeader);
  for (const o of gvarOffsets) gvar.u32(o);
  gvar.bytes(gvarData.data());

  const fvar = new Writer();
  fvar.u16(1).u16(0).u16(16).u16(2).u16(1).u16(20).u16(0).u16(8);
  fvar.tag(PROGRESS_AXIS_TAG).fixed(0).fixed(100).fixed(100).u16(0).u16(256);

  const head = new Writer();
  head
    .u32(0x00010000)
    .fixed(1)
    .u32(0)
    .u32(0x5f0f3cf5)
    .u16(0x0001 | 0x0008)
    .u16(unitsPerEm);
  head.u32(0).u32(0).u32(0).u32(0); // created, modified: left at the epoch so builds are reproducible
  head.i16(bbox.xMin).i16(bbox.yMin).i16(bbox.xMax).i16(bbox.yMax);
  head.u16(0).u16(8).i16(2).i16(1).i16(0);

  const advances = glyphs.map((g) => g.advance);
  const hhea = new Writer();
  hhea.u32(0x00010000).i16(ascender).i16(descender).i16(0).u16(most(advances));
  hhea.i16(inked.length ? bbox.xMin : 0);
  hhea.i16(inked.length ? least(inked.map((g) => g.advance - g.xMax)) : 0);
  hhea.i16(bbox.xMax).i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(numGlyphs);

  const hmtx = new Writer();
  for (const g of glyphs) hmtx.u16(g.advance).i16(g.xMin);

  const maxp = new Writer();
  maxp.u32(0x00010000).u16(numGlyphs);
  maxp.u16(most([0, ...glyphs.map((g) => g.points)])).u16(most([0, ...glyphs.map((g) => g.contours)]));
  maxp.u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  const codepoints = set.cmap.length ? set.cmap.map(([cp]) => cp) : [0x20];
  const winAscent = Math.max(ascender, bbox.yMax);
  const winDescent = Math.max(-descender, -bbox.yMin);
  const os2 = new Writer();
  os2
    .u16(4)
    .i16(round(advances.reduce((a, b) => a + b, 0) / numGlyphs))
    .u16(400)
    .u16(5)
    .u16(0);
  const sub = round(unitsPerEm * 0.65);
  os2
    .i16(sub)
    .i16(sub)
    .i16(0)
    .i16(round(unitsPerEm * 0.14))
    .i16(sub)
    .i16(sub)
    .i16(0)
    .i16(round(unitsPerEm * 0.48));
  os2
    .i16(round(unitsPerEm * 0.05))
    .i16(round(unitsPerEm * 0.26))
    .i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .tag('NONE')
    .u16(0x0040 | 0x0080);
  os2.u16(Math.min(codepoints[0]!, 0xffff)).u16(Math.min(codepoints[codepoints.length - 1]!, 0xffff));
  os2.i16(ascender).i16(descender).i16(0).u16(winAscent).u16(winDescent);
  os2
    .u32(1)
    .u32(0)
    .i16(round(unitsPerEm * 0.5))
    .i16(round(unitsPerEm * 0.7))
    .u16(0)
    .u16(32)
    .u16(1);

  const post = new Writer();
  post
    .u32(0x00030000)
    .fixed(0)
    .i16(round(-unitsPerEm * 0.1))
    .i16(round(unitsPerEm * 0.05))
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0);

  const buffer = assemble({
    'OS/2': os2.data(),
    cmap: cmapTable(set.cmap),
    fvar: fvar.data(),
    glyf: glyf.data(),
    gvar: gvar.data(),
    head: head.data(),
    hhea: hhea.data(),
    hmtx: hmtx.data(),
    loca: loca.data(),
    maxp: maxp.data(),
    name: nameTable(input.family),
    post: post.data(),
    ...set.layout,
  });
  const chars = set.cmap.filter(([, gid]) => glyphs[gid]!.contours > 0).map(([cp]) => String.fromCodePoint(cp));
  const drawn = glyphs.filter((g, gid) => gid > 0 && g.contours > 0).length;
  return { buffer, chars, glyphs: drawn, layout: Object.keys(set.layout).sort() };
}
