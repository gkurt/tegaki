/**
 * Generate the social card (packages/website/public/tegaki-card.png, the Open
 * Graph image; media/tegaki-card.png, for GitHub's social preview): "Hello,
 * world!" in the shipped Italianno bundle at 40 / 60 / 80 / 100% of its
 * animation, overlaid, so the still shows the writing in motion; a greeting
 * in each script below. Every stroke comes from the bundles, clipped to the
 * fonts' outlines as the renderer's `clipText` does.
 * Usage: bun scripts/generate-card.ts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import amiri from '../packages/renderer/fonts/amiri/bundle.ts';
import italianno from '../packages/renderer/fonts/italianno/bundle.ts';
import klee from '../packages/renderer/fonts/klee-one/bundle.ts';
import lxgw from '../packages/renderer/fonts/lxgw-wenkai/bundle.ts';
import nanum from '../packages/renderer/fonts/nanum-pen-script/bundle.ts';
import parisienne from '../packages/renderer/fonts/parisienne/bundle.ts';
import suez from '../packages/renderer/fonts/suez-one/bundle.ts';
import tangerine from '../packages/renderer/fonts/tangerine/bundle.ts';
import tillana from '../packages/renderer/fonts/tillana/bundle.ts';
import { textToSvg } from '../packages/renderer/src/lib/textToSvg.ts';
import { createHarfbuzzShaper } from '../packages/renderer/src/shaper-harfbuzz/index.ts';
import type { TegakiBundle } from '../packages/renderer/src/types.ts';
import {
  type BundleLike,
  f,
  glyphOutline,
  googleTtf,
  loadFont,
  PALETTE,
  penWidth,
  STROKE_GROUP,
  strokeLength,
  strokePath,
  svg,
  textPath,
  textWidth,
} from './brand/lib.ts';
import { layoutWriting, progressAt, type Written } from './brand/write.ts';

const OUTPUTS = ['packages/website/public/tegaki-card.png', 'media/tegaki-card.png'];
const W = 1280;
const H = 640;
const M = 88;
const pal = PALETTE.light;

const serif = await loadFont(await googleTtf('Instrument+Serif', 'instrument-serif'));
const serifItalic = await loadFont(await googleTtf('Instrument+Serif:ital@1', 'instrument-serif-italic'));
const mono = await loadFont(await googleTtf('Geist+Mono:wght@500', 'geist-mono'));
const italiannoFont = await loadFont((italianno as unknown as BundleLike).fullFontUrl!);
const kleeFont = await loadFont((klee as unknown as BundleLike).fullFontUrl!);

/** `a` → `b` by `t`, both `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const pa = a
    .slice(1)
    .match(/\w\w/g)!
    .map((h) => parseInt(h, 16));
  const pb = b
    .slice(1)
    .match(/\w\w/g)!
    .map((h) => parseInt(h, 16));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ---------------------------------------------------------------- greetings ribbon (static, shaped) — Latin first

/** [bundle, text, size multiplier] — Nanum Pen Script draws small on its em. */
const SAMPLES: [unknown, string, number?][] = [
  [parisienne, 'Bonjour', 1.1],
  [italianno, 'Ciao', 1.45],
  [tangerine, 'Hola', 1.6],
  [klee, 'こんにちは'],
  [nanum, '반가워요', 1.45],
  [lxgw, '你好'],
  [suez, 'שלום'],
  [amiri, 'مرحبا'],
  [tillana, 'नमस्ते'],
];

const samples: { inner: string; vb: [number, number, number, number] }[] = [];
for (const [i, [b, text, mult = 1]] of SAMPLES.entries()) {
  const bundle = b as TegakiBundle;
  const bufs = await Promise.all([bundle.fontUrl, ...(bundle.extraFontUrls ?? [])].map((u) => Bun.file(u).arrayBuffer()));
  const shaper = await createHarfbuzzShaper(bundle, bufs);
  // Without glyphDataById the timeline carries no glyph ids and the clip would come out empty (Nanum Pen Script).
  const out = textToSvg(text, bundle, {
    mode: 'static',
    fontSize: 100 * mult,
    shaper,
    clipText: bundle.glyphDataById ? 1.2 : false,
    color: 'currentColor',
  });
  const vb = out
    .match(/viewBox="([^"]+)"/)![1]!
    .split(' ')
    .map(Number) as [number, number, number, number];
  const inner = out
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replaceAll('id="tk-', `id="s${i}-`)
    .replaceAll('url(#tk-', `url(#s${i}-`);
  samples.push({ inner, vb });
}

/** The greetings in one row centred on `cy`, fitted into `maxW`. */
function ribbon(x: number, cy: number, size: number, maxW: number, gap = 34): string {
  let k = size / 100;
  const inkW = samples.reduce((s, sm) => s + sm.vb[2], 0);
  if (inkW * k + gap * (samples.length - 1) > maxW) k = (maxW - gap * (samples.length - 1)) / inkW;
  let pen = x;
  let out = '';
  samples.forEach((s, i) => {
    const [vx, vy, vw, vh] = s.vb;
    out += `<svg x="${f(pen)}" y="${f(cy - (vh * k) / 2)}" width="${f(vw * k)}" height="${f(vh * k)}" viewBox="${vx} ${vy} ${vw} ${vh}" color="${pal.muted}" overflow="visible">${s.inner}</svg>`;
    pen += vw * k;
    if (i < samples.length - 1) out += `<circle cx="${f(pen + gap / 2)}" cy="${f(cy)}" r="2" fill="${pal.muted}"/>`;
    pen += gap;
  });
  return out;
}

// ---------------------------------------------------------------- text

/** "Tegaki" in Instrument Serif, 手書き beside it as Klee One's outlines. */
function wordmark(x: number, baseline: number, size: number): string {
  const tracking = -size * 0.012;
  const js = size * 0.46;
  let pen = x + textWidth(serif, 'Tegaki', size, tracking) + size * 0.28;
  let jp = '';
  for (const ch of '手書き') {
    jp += glyphOutline(kleeFont, ch, js / 1000, pen, baseline);
    pen += js * 1.04;
  }
  return `<path d="${textPath(serif, 'Tegaki', x, baseline, size, tracking)}" fill="${pal.ink}"/><path d="${jp}" fill="${pal.seal}"/>`;
}

function tagline(x: number, baseline: number, size: number): string {
  const a = 'Handwriting animations for ';
  return `<path d="${textPath(serif, a, x, baseline, size)}" fill="${pal.ink}"/><path d="${textPath(serifItalic, 'every font.', x + textWidth(serif, a, size), baseline, size)}" fill="${pal.seal}"/>`;
}

function npm(right: number, y: number): string {
  const size = 19;
  const pre = '$ ';
  const w = textWidth(mono, `${pre}npm i tegaki`, size) + 36;
  const x = right - w;
  return `<rect x="${f(x)}" y="${y}" width="${f(w)}" height="42" rx="21" fill="rgb(255 255 255 / 0.5)" stroke="${pal.rule}"/><path d="${textPath(mono, pre, x + 18, y + 27.5, size)}" fill="${pal.seal}"/><path d="${textPath(mono, 'npm i tegaki', x + 18 + textWidth(mono, pre, size), y + 27.5, size)}" fill="${pal.inkSoft}"/>`;
}

// ---------------------------------------------------------------- the writing, at several moments

interface Band {
  /** Timeline position (fraction of the duration) this moment shows. */
  at: number;
  opacity: number;
  /** Draw this band's ink as dashes — the part still to be written. */
  dashed?: boolean;
}

const BANDS: Band[] = [
  { at: 0.4, opacity: 1 },
  { at: 0.6, opacity: 0.6 },
  { at: 0.8, opacity: 0.4 },
  { at: 1, opacity: 0.2, dashed: true },
];

/**
 * Several moments of one animation overlaid: each band is the ink a moment adds
 * over the one before, in that moment's opacity (as a solid shade, so bands don't
 * composite). Palest bands are painted first, so each darker band's round pen end
 * sits on top of the next.
 */
function stages(w: Written, bands: Band[]): string {
  const pieces: string[][] = [];
  let prev = w.strokes.map(() => 0);
  for (const band of bands) {
    const cur = progressAt(w, band.at * w.duration);
    const shade = mix(pal.paper, pal.ink, band.opacity);
    const out: string[] = [];
    w.strokes.forEach((s, i) => {
      const p0 = prev[i]!;
      const p1 = cur[i]!;
      if (p1 - p0 <= 0.0005) return;
      let dash = `${f(p1 - p0 + 0.0001)} 3`;
      let cap = '';
      if (band.dashed) {
        // Fixed-length dashes (px, as fractions of this stroke), square-cut so the clip shows slices of the letter.
        const len = strokeLength(s.stroke.p, w.k);
        const on = 8 / len;
        const off = 6 / len;
        const parts: number[] = [];
        for (let run = 0; run < p1 - p0; ) {
          const d = Math.min(on, p1 - p0 - run);
          parts.push(d, off);
          run += d + off;
        }
        parts[parts.length - 1] = 3;
        dash = parts.map((v) => v.toFixed(5)).join(' ');
        cap = ' stroke-linecap="butt"';
      }
      const width = penWidth(s.stroke) * 1.6 * w.k;
      out.push(
        `<path d="${strokePath(s.stroke.p, w.k, w.dx, w.dy)}" stroke="${shade}" stroke-width="${f(width)}"${cap} pathLength="1" stroke-dasharray="${dash}" stroke-dashoffset="${f(-p0)}"/>`,
      );
    });
    pieces.push(out);
    prev = cur;
  }
  return `<clipPath id="ink"><path d="${w.outline}"/></clipPath><g clip-path="url(#ink)" ${STROKE_GROUP}>${pieces.reverse().flat().join('')}</g>`;
}

// ---------------------------------------------------------------- compose + rasterize

const TEXT = 'Hello, world!';
const IT = italianno as unknown as BundleLike;
const probe = layoutWriting(IT, italiannoFont, TEXT, 0, 0, 100, 2);
const size = Math.min(300, ((W - 2 * M) / probe.width) * 100);
const writing = layoutWriting(IT, italiannoFont, TEXT, M - 10, 382, size, 2);

const card = svg(
  W,
  H,
  [
    `<rect width="${W}" height="${H}" fill="${pal.paper}"/>`,
    wordmark(M, 112, 60),
    npm(W - M, 76),
    stages(writing, BANDS),
    tagline(M, 500, 46),
    `<line x1="${M}" y1="540" x2="${W - M}" y2="540" stroke="${pal.rule}"/>`,
    ribbon(M, 588, 36, W - 2 * M),
  ].join(''),
);

// Playwright is a website dev dependency; resolve it from there.
const req = createRequire(join(import.meta.dir, '../packages/website/package.json'));
const { chromium } = (await import(req.resolve('@playwright/test'))) as typeof import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<body style="margin:0">${card}</body>`);
for (const out of OUTPUTS) await page.screenshot({ path: join(import.meta.dir, '..', out), clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();

const bytes = Bun.file(join(import.meta.dir, '..', OUTPUTS[0]!)).size;
console.log(`Generated ${OUTPUTS.join(', ')} (${(bytes / 1024).toFixed(0)} KB)`);
// Social previews must stay under 1 MB (paper grain is left out for this reason: noise doesn't compress).
if (bytes > 1024 * 1024) throw new Error('card is over 1 MB');
