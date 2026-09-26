/**
 * Generate the logo (packages/website/src/assets/tegaki.svg + tegaki-dark.svg,
 * media/tegaki.svg) and the favicon (packages/website/public/favicon.svg): テ
 * from the shipped Klee One bundle caught mid-write on a practice tile, its
 * last stroke in seal red; the logo numbers the strokes the way kanji drills
 * teach them. Strokes are clipped to the font's outline as the renderer's
 * `clipText` does.
 * Usage: bun scripts/generate-logo.ts
 */
import { join } from 'node:path';
import klee from '../packages/renderer/fonts/klee-one/bundle.ts';
import {
  type BundleLike,
  drawStrokes,
  f,
  fit,
  glyph,
  glyphOutline,
  googleTtf,
  loadFont,
  PALETTE,
  type Palette,
  STROKE_GROUP,
  svg,
  textPath,
  textWidth,
} from './brand/lib.ts';

const KLEE = klee as unknown as BundleLike;
const kleeFont = await loadFont(KLEE.fullFontUrl!);
const serifItalic = await loadFont(await googleTtf('Instrument+Serif:ital@1', 'instrument-serif-italic'));

const TE = glyph(KLEE, 'テ');
/** How far each stroke is written. */
const PROGRESS = [1, 1, 0.62];
/** The stroke drawn in seal red. */
const ACCENT = 2;
type Box = { x0: number; y0: number; x1: number; y1: number };
/** The em square around テ, so it sits like it would on a practice sheet. */
const TE_BOX: Box = { x0: 60, y0: -800, x1: 940, y1: 80 };

interface MidWriteOpts {
  /** Canvas box the glyph's em square fits in. */
  x: number;
  y: number;
  size: number;
  pal: Palette;
  progress: number[];
  ghost: number;
  weight: number;
  numbers?: boolean;
  id: string;
  box?: Box;
}

/** テ caught mid-write: ghost outline, strokes clipped to the letter. */
function midWrite(o: MidWriteOpts): string {
  const box = o.box ?? TE_BOX;
  const { k, dx, dy } = fit(box, o.size, o.size, 0, o.x + o.size / 2, o.y + o.size / 2);
  const outline = glyphOutline(kleeFont, 'テ', k, dx, dy);
  const color = (i: number) => (i === ACCENT ? o.pal.seal : o.pal.ink);
  let out = `<clipPath id="${o.id}-clip"><path d="${outline}"/></clipPath>`;
  out += `<path d="${outline}" fill="${o.pal.ink}" opacity="${o.ghost}"/>`;
  out += `<g clip-path="url(#${o.id}-clip)" ${STROKE_GROUP}>${drawStrokes(TE.s, { k, dx, dy, color: o.pal.ink, weight: o.weight, strokeColor: color, progress: (i) => o.progress[i] ?? 1 })}</g>`;
  if (o.numbers) {
    // Drill-book numerals by each stroke's start (offsets in font units, tuned for テ).
    const nsize = o.size * 0.1;
    const OFFSETS: [number, number][] = [
      [-95, -10],
      [-95, 10],
      [95, 25],
    ];
    TE.s.forEach((s, i) => {
      const [sx, sy] = s.p[0]!;
      const [ox, oy] = OFFSETS[i] ?? [-90, 0];
      const cx = (sx + ox) * k + dx;
      const cy = (sy + oy) * k + dy;
      const label = String(i + 1);
      const w = textWidth(serifItalic, label, nsize);
      out += `<path d="${textPath(serifItalic, label, cx - w / 2, cy + nsize * 0.34, nsize)}" fill="${i === ACCENT ? o.pal.seal : o.pal.muted}"/>`;
    });
  }
  return out;
}

/** 田-style practice grid: frame plus dashed centre lines. */
function practiceGrid(x: number, y: number, s: number, pal: Palette): string {
  const c = s / 2;
  const w = s * 0.006;
  return `<g fill="none" stroke="${pal.seal}"><rect x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s)}" stroke-width="${f(w * 1.6)}" opacity="0.55"/><path d="M${f(x + c)} ${f(y)}V${f(y + s)}M${f(x)} ${f(y + c)}H${f(x + s)}" stroke-width="${f(w)}" stroke-dasharray="${f(s * 0.022)} ${f(s * 0.022)}" opacity="0.4"/></g>`;
}

const S = 512;

function logo(pal: Palette, ghost: number): string {
  return svg(
    S,
    S,
    `<rect width="${S}" height="${S}" rx="112" fill="${pal.card}"/>${practiceGrid(56, 56, 400, pal)}${midWrite({ id: 'so', x: 76, y: 76, size: 360, pal, progress: PROGRESS, ghost, weight: 1.7, numbers: true })}`,
  );
}

// Legible at 16px: a thicker pen, no grid, the glyph filling the tile.
const light = PALETTE.light;
const favicon = svg(
  64,
  64,
  `<rect width="64" height="64" rx="14" fill="${light.card}"/><rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${light.ink}" stroke-opacity="0.14" stroke-width="2"/>${midWrite({ id: 'fm', x: -3, y: -1, size: 70, pal: light, progress: [1, 1, 0.6], ghost: 0.16, weight: 2.2, box: { x0: 110, y0: -760, x1: 890, y1: 20 } })}`,
);

const OUTPUTS: Record<string, string> = {
  'packages/website/src/assets/tegaki.svg': logo(PALETTE.light, 0.1),
  'packages/website/src/assets/tegaki-dark.svg': logo(PALETTE.dark, 0.14),
  'media/tegaki.svg': logo(PALETTE.light, 0.1),
  'packages/website/public/favicon.svg': favicon,
};
for (const [path, content] of Object.entries(OUTPUTS)) await Bun.write(join(import.meta.dir, '..', path), content);
console.log(`Generated ${Object.keys(OUTPUTS).join(', ')}`);
