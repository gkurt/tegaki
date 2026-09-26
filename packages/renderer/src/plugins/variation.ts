import { createPlugin } from '../core/createPlugin.ts';
import { seededRandom } from '../lib/random.ts';
import type { GlyphPlacement } from '../lib/strokeTimeline.ts';

/** How far each glyph can stray from the font, before `amount` scales it all. */
export interface VariationOptions {
  /** Scales everything below: 0 draws the font as it is, 2 twice as loose. */
  amount: number;
  /** Size, as a share of the glyph's: 0.05 lets a glyph grow or shrink by up to 5%. */
  size: number;
  /** Lean, in degrees either way. */
  slant: number;
  /** Turn, in degrees either way. */
  rotation: number;
  /** Shift off the glyph's place, in ems either way. */
  drift: number;
  /** A slow bend through the glyph, in ems — its strokes curve a little differently each time. */
  warp: number;
  /** Ink width, as a share of the stroke's: 0.1 lets a stroke run up to 10% thinner or thicker. */
  width: number;
}

/** A point in a glyph's own font units: x from its origin, y down from its baseline. */
interface FontPoint {
  x: number;
  y: number;
}

/** Where the glyph turns, leans and grows about, in ems from its origin — about the middle of a small letter. */
const PIVOT = { x: 0.25, y: -0.3 };

/**
 * The way one glyph strays from the font: a function moving any point of it,
 * in its own font units — its strokes and its outline alike, so clip-to-text
 * follows the ink. Built from `seed` alone (the glyph's seed), so the same
 * glyph at the same seed strays the same way every time. `em` is the font's
 * units per em.
 */
export function variationField(seed: number, o: VariationOptions, em: number): (p: FontPoint) => FontPoint {
  const random = seededRandom(seed, 'variation');
  const signed = () => random() * 2 - 1;
  const a = o.amount;
  const scale = 1 + a * o.size * signed();
  const shear = Math.tan((a * o.slant * signed() * Math.PI) / 180);
  const turn = (a * o.rotation * signed() * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const shiftX = a * o.drift * signed() * em;
  const shiftY = a * o.drift * signed() * em;
  // Two slow waves across the glyph, one per axis, each at its own angle and
  // phase: about one bend per em, so a stroke curves rather than wiggles.
  const bend = a * o.warp * em;
  const wave = () => ({ fx: (1 + random()) * signed(), fy: (1 + random()) * signed(), phase: random() * Math.PI * 2 });
  const wx = wave();
  const wy = wave();
  const px = PIVOT.x * em;
  const py = PIVOT.y * em;
  return ({ x, y }) => {
    const u = x / em;
    const v = y / em;
    const bx = bend * Math.sin(wx.fx * u + wx.fy * v + wx.phase);
    const by = bend * Math.sin(wy.fx * u + wy.fy * v + wy.phase);
    // About the pivot: grow, lean (the top goes right for a positive slant), turn.
    const dx = (x - px) * scale - (y - py) * scale * shear;
    const dy = (y - py) * scale;
    return {
      x: px + dx * cos - dy * sin + shiftX + bx,
      y: py + dx * sin + dy * cos + shiftY + by,
    };
  };
}

/** A stroke's width along it: one factor for the stroke, and a gentle swell or pinch toward its middle. */
export function variationWidth(seed: number, strokeKey: string, o: VariationOptions): (t: number) => number {
  const random = seededRandom(seed, `variation-width:${strokeKey}`);
  const overall = random() * 2 - 1;
  const swell = random() * 2 - 1;
  const w = o.amount * o.width;
  return (t) => Math.max(0.05, 1 + w * (0.7 * overall + 0.5 * swell * Math.sin(Math.PI * t)));
}

/** `field` moving a point in px, through its glyph's font units. */
function inPx(field: (p: FontPoint) => FontPoint, place: GlyphPlacement) {
  return <P extends { x: number; y: number }>(p: P): P => {
    const moved = field({ x: (p.x - place.x) / place.scale, y: (p.y - place.y) / place.scale - place.ascender });
    return { ...p, x: place.x + moved.x * place.scale, y: place.y + (moved.y + place.ascender) * place.scale };
  };
}

/**
 * Handwriting that's never quite the same twice: every glyph grows or
 * shrinks a little, leans, turns, drifts off its place and bends, and every
 * stroke runs a little thinner or thicker — each glyph its own way, while
 * keeping its shape. How each glyph strays comes from its seed (the
 * renderer's `seed` plus its place in the text), so repeated letters differ
 * from each other, the same seed draws the same text every time, and
 * `seed: 'random'` draws it anew on every load.
 *
 * ```ts
 * plugins: [variationPlugin()]                 // the defaults
 * plugins: [variationPlugin({ amount: 1.6 })]  // looser
 * ```
 */
export const variationPlugin = createPlugin({
  name: 'variation',
  label: 'Variation',
  description: 'Every glyph a little different — size, lean, turn, place, a bend and the ink width — from its seed. geometry + outline.',
  params: {
    amount: { type: 'number', label: 'Amount', description: 'Scales everything below.', default: 1, min: 0, max: 2, step: 0.05 },
    size: {
      type: 'number',
      label: 'Size',
      description: "Growth or shrink, as a share of the glyph's size.",
      default: 0.05,
      min: 0,
      max: 0.2,
      step: 0.01,
    },
    slant: { type: 'number', label: 'Slant', description: 'Lean, in degrees either way.', default: 4, min: 0, max: 15, step: 0.5 },
    rotation: { type: 'number', label: 'Rotation', description: 'Turn, in degrees either way.', default: 2, min: 0, max: 10, step: 0.5 },
    drift: { type: 'number', label: 'Drift', description: 'Shift off its place, in ems.', default: 0.02, min: 0, max: 0.1, step: 0.005 },
    warp: {
      type: 'number',
      label: 'Warp',
      description: 'A slow bend through the glyph, in ems.',
      default: 0.015,
      min: 0,
      max: 0.08,
      step: 0.005,
    },
    width: {
      type: 'number',
      label: 'Width',
      description: "Ink width, as a share of the stroke's.",
      default: 0.12,
      min: 0,
      max: 0.5,
      step: 0.01,
    },
  },
  presets: {
    Subtle: { amount: 0.5 },
    Loose: { amount: 1.6 },
    Signature: { slant: 8, warp: 0.03, size: 0.08, rotation: 3 },
  },
  setup: (options) => {
    const fields = new Map<string, (p: FontPoint) => FontPoint>();
    const fieldFor = (seed: number, em: number) => {
      const key = `${seed}|${em}`;
      let field = fields.get(key);
      if (!field) {
        // Seeds come and go as the text or the renderer's seed changes; keep the cache from growing without end.
        if (fields.size > 4096) fields.clear();
        fields.set(key, (field = variationField(seed, options, em)));
      }
      return field;
    };
    return {
      geometry(path, g) {
        const move = inPx(fieldFor(g.seed, g.fontSize / g.place.scale), g.place);
        const width = variationWidth(g.seed, String(g.stroke.strokeIndex), options);
        return path.map((p) => ({ ...move(p), width: p.width * width(p.t) }));
      },
      outline(contour, o) {
        const move = inPx(fieldFor(o.seed, o.fontSize / o.place.scale), o.place);
        return contour.map(move);
      },
    };
  },
});
