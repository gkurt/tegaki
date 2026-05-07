import { describe, expect, test } from 'bun:test';
import type { TegakiBundle, TegakiGlyphData } from '../types.ts';
import type { BundleShaper, ShapedGlyph } from './shaper.ts';
import { computeTimeline } from './timeline.ts';

const stroke = (d: number, a: number) => ({ p: [[0, 0, 1] as [number, number, number]], d, a });
const glyph = (w: number, t: number): TegakiGlyphData => ({ w, t, s: [stroke(0, t)] });

interface ScriptedGlyph {
  g: string;
  cl: number;
  ax?: number;
}

/**
 * Build a scripted shaper that returns a fixed glyph list per input. Used to
 * pin shaping behaviour without spinning up harfbuzz.
 */
function scriptedShaper(plan: Record<string, ScriptedGlyph[]>): BundleShaper {
  return {
    shape(text: string): ShapedGlyph[] {
      const out = plan[text];
      if (!out) throw new Error(`scriptedShaper: no plan for ${JSON.stringify(text)}`);
      return out.map((g) => ({ g: g.g, cl: g.cl, ax: g.ax ?? 0, ay: 0, dx: 0, dy: 0 }));
    },
  };
}

function makeBundle(opts: { glyphData: Record<string, TegakiGlyphData>; glyphDataById?: Record<string, TegakiGlyphData> }): TegakiBundle {
  return {
    family: 'test',
    lineCap: 'round',
    fontUrl: '',
    fontFaceCSS: '',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphData: opts.glyphData,
    ...(opts.glyphDataById ? { glyphDataById: opts.glyphDataById } : {}),
  };
}

describe('computeTimeline (shaper path)', () => {
  test('falls back to leading codepoint for nominal glyphs in multi-codepoint clusters', () => {
    // Mirrors Devanagari `हि`: HarfBuzz emits two glyphs at cl=0 — the i-matra
    // (reordered, present in glyphDataById) and the bare consonant ह (nominal,
    // *not* in glyphDataById). Pre-fix, the bare ह fell through to
    // glyphData["हि"] (multi-codepoint key, never populated) and collapsed
    // onto the 0.2s unknownDuration slot. The fix peels off the leading
    // codepoint so glyphData["ह"] satisfies the lookup and the entry inherits
    // its real stroke duration.
    const bundle = makeBundle({
      glyphData: { ह: glyph(700, 1.5) },
      glyphDataById: { 'matra-i': glyph(200, 0.6) },
    });
    const shaper = scriptedShaper({
      हि: [
        { g: 'matra-i', cl: 0, ax: 200 },
        { g: 'ha-nominal', cl: 0, ax: 700 },
      ],
    });

    const tl = computeTimeline('हि', bundle, undefined, shaper);
    const [matra, ha] = tl.entries;
    expect(matra?.hasGlyph).toBe(true);
    expect(matra?.duration).toBeCloseTo(0.6);
    expect(ha?.hasGlyph).toBe(true);
    // 1.5 — the bundle's `ह` duration — not 0.2 (`unknownDuration`).
    expect(ha?.duration).toBeCloseTo(1.5);
  });

  test('total duration sums real stroke durations (no unknownDuration collapse)', () => {
    // The same scenario, viewed from the timeline-length angle: pre-fix the
    // total was 0.6 + 0.1 (gap) + 0.2 (unknown for ह) = 0.9s; post-fix it's
    // 0.6 + 0.1 + 1.5 = 2.2s. The user-visible symptom was the animation
    // ending ~1.3s short of "fully drawn" — this asserts we no longer trim
    // ह's body off the schedule.
    const bundle = makeBundle({
      glyphData: { ह: glyph(700, 1.5) },
      glyphDataById: { 'matra-i': glyph(200, 0.6) },
    });
    const shaper = scriptedShaper({
      हि: [
        { g: 'matra-i', cl: 0, ax: 200 },
        { g: 'ha-nominal', cl: 0, ax: 700 },
      ],
    });

    const tl = computeTimeline('हि', bundle, undefined, shaper);
    expect(tl.totalDuration).toBeCloseTo(2.2);
  });

  test('still marks hasGlyph=false when neither variant nor leading codepoint is known', () => {
    // Genuinely missing glyph data must keep its fallback path so the engine
    // can DOM-fillText the entry. This guards against the lookup mistakenly
    // resolving to `undefined`-as-truthy or any other silent recovery.
    const bundle = makeBundle({ glyphData: {} });
    const shaper = scriptedShaper({ हि: [{ g: 'unknown', cl: 0, ax: 100 }] });

    const tl = computeTimeline('हि', bundle, undefined, shaper);
    expect(tl.entries[0]?.hasGlyph).toBe(false);
  });
});
