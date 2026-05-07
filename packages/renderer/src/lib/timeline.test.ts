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

describe('computeTimeline for Devanagari "द्" (consonant + virama)', () => {
  // The Tillana bundle ships:
  //   glyphData["द"]  → 2 strokes,  t = 0.778 (bare consonant DA)
  //   glyphData["्"] → 1 stroke,   t = 0.109 (bare virama)
  //   glyphDataById[<halfDA>] → 3 strokes, t = 1.015 (DA half-form)
  // HarfBuzz collapses "द्" into the single half-form glyph.
  const bareDa = (): TegakiGlyphData => ({
    w: 469,
    t: 0.778,
    s: [stroke(0, 0.088), stroke(0.238, 0.54)],
  });
  const bareVirama = (): TegakiGlyphData => ({ w: 0, t: 0.109, s: [stroke(0, 0.109)] });
  const halfDa = (): TegakiGlyphData => ({
    w: 469,
    t: 1.015,
    s: [stroke(0, 0.088), stroke(0.238, 0.545), stroke(0.933, 0.082)],
  });

  test('shaper path: half-form glyph drives totalDuration', () => {
    // When the harfbuzz shaper is registered, "द्" shapes to a single half-
    // form glyph whose data lives in glyphDataById. The timeline picks that
    // up and reports the half-form's full 1.015s duration — what the
    // renderer actually needs to draw all three strokes.
    const bundle = makeBundle({
      glyphData: { द: bareDa(), '्': bareVirama() },
      glyphDataById: { halfDA: halfDa() },
    });
    const shaper = scriptedShaper({ द्: [{ g: 'halfDA', cl: 0, ax: 469 }] });

    const tl = computeTimeline('द्', bundle, undefined, shaper);
    expect(tl.entries.length).toBe(1);
    expect(tl.entries[0]?.glyphId).toBe('halfDA');
    expect(tl.entries[0]?.duration).toBeCloseTo(1.015);
    expect(tl.totalDuration).toBeCloseTo(1.015);
  });

  test('grapheme path: falls through to bare consonant and truncates the timeline', () => {
    // The buggy case. `computeTimeline(text, bundle)` — no shaper — can't
    // see that "द्" really renders as a half-form. It looks up the cluster
    // string "द्" directly (miss), peels the leading codepoint to "द"
    // (hit), and pins the entry to the bare consonant's 0.778s.
    //
    // The renderer engine, which DOES have the shaper, animates the half-
    // form for ~1.015s. Any caller that uses this no-shaper totalDuration as
    // the "animation finished" signal (e.g. TegakiTextPreview reporting it
    // via onReady) stops the clock 0.237s early — which is exactly when the
    // half-form's third stroke starts (d = 0.933). Visible symptom: the
    // final stroke never appears.
    const bundle = makeBundle({
      glyphData: { द: bareDa(), '्': bareVirama() },
      glyphDataById: { halfDA: halfDa() },
    });

    const tl = computeTimeline('द्', bundle);
    expect(tl.entries.length).toBe(1);
    expect(tl.entries[0]?.char).toBe('द्');
    // Bare-consonant duration leaks through — the half-form is invisible
    // to the grapheme path even though its data is sitting in the bundle.
    expect(tl.entries[0]?.duration).toBeCloseTo(0.778);
    expect(tl.totalDuration).toBeCloseTo(0.778);
  });

  test('shaper and grapheme totalDurations diverge for the same bundle', () => {
    // Same bundle, same text, two different totalDurations depending on
    // whether a shaper was passed. Locks in the divergence so any future
    // fix (e.g. teaching computeTimeline to consult glyphDataById via
    // cluster decomposition, or routing all callers through the engine's
    // shaper-aware timeline) has a clear regression target.
    const bundle = makeBundle({
      glyphData: { द: bareDa(), '्': bareVirama() },
      glyphDataById: { halfDA: halfDa() },
    });
    const shaper = scriptedShaper({ द्: [{ g: 'halfDA', cl: 0, ax: 469 }] });

    const withShaper = computeTimeline('द्', bundle, undefined, shaper).totalDuration;
    const withoutShaper = computeTimeline('द्', bundle).totalDuration;

    expect(withShaper).toBeCloseTo(1.015);
    expect(withoutShaper).toBeCloseTo(0.778);
    expect(withShaper - withoutShaper).toBeCloseTo(0.237);
  });

  test("grapheme-path duration cuts off before the half-form's last stroke begins", () => {
    // The half-form's third stroke has d = 0.933. The grapheme-path total
    // (0.778) is less than that delay — so when the engine clamps localTime
    // to entry.duration in this regime, stroke 2 never gets a chance to
    // start animating. This is the precise mechanism behind "some parts of
    // the text still aren't rendered when the animation ends."
    const bundle = makeBundle({
      glyphData: { द: bareDa(), '्': bareVirama() },
      glyphDataById: { halfDA: halfDa() },
    });

    const tl = computeTimeline('द्', bundle);
    const lastStrokeDelay = halfDa().s[2]!.d;
    expect(lastStrokeDelay).toBeCloseTo(0.933);
    expect(tl.totalDuration).toBeLessThan(lastStrokeDelay);
  });
});
