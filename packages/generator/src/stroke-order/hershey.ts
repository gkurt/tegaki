// Hershey stroke-order providers (Latin letters and digits, Greek).
//
// KanjiVG's Latin references are print-style — M as four strokes, m as
// three — which cursive fonts like Caveat genuinely contradict (their m is
// one continuous trajectory). The Hershey fonts are digitized PEN
// trajectories per letter, so they supply style variants the pipeline can
// choose between: `hershey-script` (Script simplex, formal cursive) and
// `hershey-simplex` (Simplex/futural, plain print — also the only reliable
// digit reference; the Script digits are double-stroked ornamentals and are
// excluded). Every variant is evaluated against the extracted ink and the
// best re-match wins, so print fonts pick print references and cursive
// fonts pick cursive ones. `hershey-greek` (Greek simplex) is the Greek
// alphabet in the Simplex hand.
//
// The faces are embedded as raw JHF (hershey-jhf.ts) and parsed on first
// use; a plotter's pen-up hop back to a point it drew through becomes part
// of one stroke (`mergeRetraces` — cursive m is ONE pen motion).
//
// Like every provider, these are consultation-only: reference polylines
// inform order/direction/grouping decisions and never enter generated
// bundles.

import { FUTURAL_JHF, GREEKS_JHF, SCRIPTS_JHF } from './hershey-jhf.ts';
import { type JhfStrokes, jhfByAscii, mergeRetraces } from './jhf.ts';
import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

export const HERSHEY_LICENSE =
  'Hershey fonts by Dr. A. V. Hershey, U.S. National Bureau of Standards; JHF format by James Hurt, Cognition, Inc. — free use with these acknowledgements';

/**
 * The Hershey frame: coordinates are (code - 'R') pairs, y-down, centered
 * near the origin; letters span roughly -16..21. Only the frame SIZE matters
 * downstream (registration uses it for thin-span detection), not the origin.
 */
const HERSHEY_VIEWBOX = { width: 32, height: 32 };

const LATIN = /^[A-Za-z]$/;
const LATIN_AND_DIGITS = /^[A-Za-z0-9]$/;

/** Greek simplex keeps its letters on A–X / a–x, in alphabet order. */
const GREEK_UPPER = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
const GREEK_LOWER = 'αβγδεζηθικλμνξοπρστυφχψω';

/** A face's glyphs by the character each draws. */
function glyphsOf(jhf: string, keep: RegExp): Record<string, JhfStrokes> {
  const out: Record<string, JhfStrokes> = {};
  for (const [char, strokes] of Object.entries(jhfByAscii(jhf))) if (keep.test(char)) out[char] = mergeRetraces(strokes);
  return out;
}

function greekGlyphs(): Record<string, JhfStrokes> {
  const ascii = jhfByAscii(GREEKS_JHF);
  const out: Record<string, JhfStrokes> = {};
  [...GREEK_UPPER].forEach((letter, i) => {
    out[letter] = mergeRetraces(ascii[String.fromCharCode(65 + i)]!);
  });
  [...GREEK_LOWER].forEach((letter, i) => {
    out[letter] = mergeRetraces(ascii[String.fromCharCode(97 + i)]!);
  });
  return out;
}

function createProvider(name: string, load: () => Record<string, JhfStrokes>): StrokeOrderProvider {
  let glyphs: Record<string, JhfStrokes> | undefined;
  const cache = new Map<string, ReferenceGlyph | null>();
  return {
    name,
    async get(char: string): Promise<ReferenceGlyph | null> {
      let entry = cache.get(char);
      if (entry === undefined) {
        glyphs ??= load();
        const strokes = glyphs[char];
        entry = strokes
          ? {
              char,
              strokes: strokes.map((s) => ({ points: s.map(([x, y]) => ({ x, y })) })),
              viewBox: HERSHEY_VIEWBOX,
              source: name,
              license: HERSHEY_LICENSE,
            }
          : null;
        cache.set(char, entry);
      }
      return entry;
    },
  };
}

/** Cursive Latin stroke-order references from the Hershey Script simplex font. */
export function createHersheyProvider(): StrokeOrderProvider {
  return createProvider('hershey-script', () => glyphsOf(SCRIPTS_JHF, LATIN));
}

/** Print Latin + digit stroke-order references from the Hershey Simplex (futural) font. */
export function createHersheySimplexProvider(): StrokeOrderProvider {
  return createProvider('hershey-simplex', () => glyphsOf(FUTURAL_JHF, LATIN_AND_DIGITS));
}

/** Greek stroke-order references from the Hershey Greek simplex font. */
export function createHersheyGreekProvider(): StrokeOrderProvider {
  return createProvider('hershey-greek', greekGlyphs);
}
