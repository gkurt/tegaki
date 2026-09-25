// Hangul stroke-order provider: references composed from jamo templates.
//
// Hangul stroke order is standardized per jamo (the 14 basic consonants and
// 10 basic vowels; doubled consonants, final clusters and compound vowels are
// built from them), and a syllable is written initial → vowel → final. No
// dataset is needed: each precomposed syllable (U+AC00–U+D7A3) is decomposed
// arithmetically, each jamo's template strokes are placed in the box the
// standard layout gives it for its vowel class, and the result is an
// ordinary reference the pipeline registers onto the ink and matches — so a
// font whose jamo sit elsewhere simply fails the match and keeps heuristic
// order. Compatibility jamo (ㄱ, ㅏ …) get their template on the full frame.
//
// Templates are centerlines in a unit box (y down), in pen order and pen
// direction: horizontals left to right, verticals top to bottom, ㅇ
// counter-clockwise from the top.

import type { ReferenceGlyph, StrokeOrderProvider } from './types.ts';

type Polyline = [number, number][];
type Box = [x1: number, y1: number, x2: number, y2: number];

/** Unit-box ㅇ, counter-clockwise from the top. */
const RING: Polyline = Array.from({ length: 13 }, (_, i) => {
  const a = -Math.PI / 2 - (i / 12) * 2 * Math.PI;
  return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)];
});

const inBox = (strokes: Polyline[], [x1, y1, x2, y2]: Box): Polyline[] =>
  strokes.map((s) => s.map(([x, y]) => [x1 + x * (x2 - x1), y1 + y * (y2 - y1)]));

const GIYEOK: Polyline[] = [
  [
    [0.1, 0.15],
    [0.85, 0.15],
    [0.8, 0.9],
  ],
];
const NIEUN: Polyline[] = [
  [
    [0.15, 0.1],
    [0.15, 0.85],
    [0.9, 0.85],
  ],
];
const JIEUT: Polyline[] = [
  [
    [0.15, 0.15],
    [0.8, 0.15],
    [0.15, 0.9],
  ],
  [
    [0.5, 0.5],
    [0.9, 0.9],
  ],
];

/** The 14 basic consonants. */
const CONSONANTS: Record<string, Polyline[]> = {
  ㄱ: GIYEOK,
  ㄴ: NIEUN,
  ㄷ: [
    [
      [0.15, 0.15],
      [0.85, 0.15],
    ],
    [
      [0.15, 0.15],
      [0.15, 0.85],
      [0.9, 0.85],
    ],
  ],
  ㄹ: [
    [
      [0.15, 0.1],
      [0.85, 0.1],
      [0.85, 0.47],
    ],
    [
      [0.15, 0.48],
      [0.85, 0.48],
    ],
    [
      [0.15, 0.48],
      [0.15, 0.9],
      [0.9, 0.9],
    ],
  ],
  ㅁ: [
    [
      [0.15, 0.12],
      [0.15, 0.88],
    ],
    [
      [0.15, 0.12],
      [0.85, 0.12],
      [0.85, 0.88],
    ],
    [
      [0.15, 0.88],
      [0.85, 0.88],
    ],
  ],
  ㅂ: [
    [
      [0.15, 0.1],
      [0.15, 0.9],
    ],
    [
      [0.85, 0.1],
      [0.85, 0.9],
    ],
    [
      [0.15, 0.5],
      [0.85, 0.5],
    ],
    [
      [0.15, 0.9],
      [0.85, 0.9],
    ],
  ],
  ㅅ: [
    [
      [0.5, 0.1],
      [0.1, 0.9],
    ],
    [
      [0.5, 0.45],
      [0.9, 0.9],
    ],
  ],
  ㅇ: [RING],
  ㅈ: JIEUT,
  ㅊ: [
    [
      [0.45, 0.02],
      [0.55, 0.14],
    ],
    ...inBox(JIEUT, [0, 0.2, 1, 1]),
  ],
  ㅋ: [
    ...GIYEOK,
    [
      [0.1, 0.5],
      [0.82, 0.5],
    ],
  ],
  ㅌ: [
    [
      [0.15, 0.1],
      [0.85, 0.1],
    ],
    [
      [0.15, 0.5],
      [0.8, 0.5],
    ],
    [
      [0.15, 0.1],
      [0.15, 0.9],
      [0.9, 0.9],
    ],
  ],
  ㅍ: [
    [
      [0.1, 0.12],
      [0.9, 0.12],
    ],
    [
      [0.3, 0.12],
      [0.35, 0.86],
    ],
    [
      [0.7, 0.12],
      [0.65, 0.86],
    ],
    [
      [0.05, 0.88],
      [0.95, 0.88],
    ],
  ],
  ㅎ: [
    [
      [0.45, 0.02],
      [0.55, 0.14],
    ],
    [
      [0.1, 0.3],
      [0.9, 0.3],
    ],
    ...inBox([RING], [0.2, 0.4, 0.8, 1]),
  ],
};

/** Doubled consonants and final clusters: two basic consonants side by side, left first. */
const CONSONANT_PAIRS: Record<string, [string, string]> = {
  ㄲ: ['ㄱ', 'ㄱ'],
  ㄸ: ['ㄷ', 'ㄷ'],
  ㅃ: ['ㅂ', 'ㅂ'],
  ㅆ: ['ㅅ', 'ㅅ'],
  ㅉ: ['ㅈ', 'ㅈ'],
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};

/** A consonant's strokes per letter (a double or cluster is two letters, side by side). */
function consonant(jamo: string): Polyline[][] {
  const pair = CONSONANT_PAIRS[jamo];
  if (!pair) return CONSONANTS[jamo] ? [CONSONANTS[jamo]!] : [];
  return [inBox(CONSONANTS[pair[0]]!, [0, 0, 0.5, 1]), inBox(CONSONANTS[pair[1]]!, [0.5, 0, 1, 1])];
}

const vertical = (x: number): [number, number][] => [
  [x, 0],
  [x, 1],
];
const horizontal = (y: number): [number, number][] => [
  [0, y],
  [1, y],
];

/** Vowels written beside the initial: stems top to bottom, ticks left to right — in left-to-right order. */
const VERTICAL_VOWELS: Record<string, Polyline[]> = {
  ㅏ: [
    vertical(0.4),
    [
      [0.4, 0.5],
      [0.85, 0.5],
    ],
  ],
  ㅐ: [
    vertical(0.3),
    [
      [0.3, 0.5],
      [0.65, 0.5],
    ],
    vertical(0.75),
  ],
  ㅑ: [
    vertical(0.4),
    [
      [0.4, 0.35],
      [0.85, 0.35],
    ],
    [
      [0.4, 0.65],
      [0.85, 0.65],
    ],
  ],
  ㅒ: [
    vertical(0.3),
    [
      [0.3, 0.35],
      [0.65, 0.35],
    ],
    [
      [0.3, 0.65],
      [0.65, 0.65],
    ],
    vertical(0.75),
  ],
  ㅓ: [
    [
      [0.15, 0.5],
      [0.6, 0.5],
    ],
    vertical(0.6),
  ],
  ㅔ: [
    [
      [0.1, 0.5],
      [0.4, 0.5],
    ],
    vertical(0.4),
    vertical(0.75),
  ],
  ㅕ: [
    [
      [0.15, 0.35],
      [0.6, 0.35],
    ],
    [
      [0.15, 0.65],
      [0.6, 0.65],
    ],
    vertical(0.6),
  ],
  ㅖ: [
    [
      [0.1, 0.35],
      [0.4, 0.35],
    ],
    [
      [0.1, 0.65],
      [0.4, 0.65],
    ],
    vertical(0.4),
    vertical(0.75),
  ],
  ㅣ: [vertical(0.5)],
};

/** Vowels written under the initial: in top-to-bottom order. */
const HORIZONTAL_VOWELS: Record<string, Polyline[]> = {
  ㅗ: [
    [
      [0.5, 0.1],
      [0.5, 0.55],
    ],
    horizontal(0.6),
  ],
  ㅛ: [
    [
      [0.35, 0.1],
      [0.35, 0.55],
    ],
    [
      [0.65, 0.1],
      [0.65, 0.55],
    ],
    horizontal(0.6),
  ],
  ㅜ: [
    horizontal(0.4),
    [
      [0.5, 0.4],
      [0.5, 0.9],
    ],
  ],
  ㅠ: [
    horizontal(0.4),
    [
      [0.35, 0.4],
      [0.35, 0.9],
    ],
    [
      [0.65, 0.4],
      [0.65, 0.9],
    ],
  ],
  ㅡ: [horizontal(0.5)],
};

/** Compound vowels: the part under the initial, then the part beside it. */
const COMPOUND_VOWELS: Record<string, [string, string]> = {
  ㅘ: ['ㅗ', 'ㅏ'],
  ㅙ: ['ㅗ', 'ㅐ'],
  ㅚ: ['ㅗ', 'ㅣ'],
  ㅝ: ['ㅜ', 'ㅓ'],
  ㅞ: ['ㅜ', 'ㅔ'],
  ㅟ: ['ㅜ', 'ㅣ'],
  ㅢ: ['ㅡ', 'ㅣ'],
};

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

/** A precomposed syllable's jamo (initial, vowel, final — '' when none), or null outside U+AC00–U+D7A3. */
export function decomposeHangul(char: string): [initial: string, vowel: string, final: string] | null {
  const cp = char.codePointAt(0);
  if (cp == null || cp < 0xac00 || cp > 0xd7a3 || [...char].length !== 1) return null;
  const s = cp - 0xac00;
  return [INITIALS[Math.floor(s / 588)]!, VOWELS[Math.floor((s % 588) / 28)]!, FINALS[s % 28]!];
}

/**
 * Jamo boxes (unit square, y down) per vowel class, without and with a
 * final — the standard layout, roughly: a vertical vowel stands right of the
 * initial, a horizontal one under it, a compound wraps it; a final takes the
 * bottom third.
 */
const LAYOUTS = {
  vertical: { initial: [0.05, 0.1, 0.55, 0.9], beside: [0.6, 0, 0.95, 1] },
  horizontal: { initial: [0.15, 0.05, 0.85, 0.5], under: [0, 0.55, 1, 0.95] },
  compound: { initial: [0.05, 0.05, 0.55, 0.45], under: [0, 0.5, 0.7, 0.9], beside: [0.7, 0, 1, 1] },
  verticalFinal: { initial: [0.05, 0.05, 0.55, 0.5], beside: [0.6, 0, 0.95, 0.6], final: [0.15, 0.65, 0.85, 0.98] },
  horizontalFinal: { initial: [0.15, 0.02, 0.85, 0.32], under: [0, 0.35, 1, 0.62], final: [0.15, 0.66, 0.85, 0.98] },
  compoundFinal: {
    initial: [0.05, 0.02, 0.55, 0.32],
    under: [0, 0.35, 0.7, 0.62],
    beside: [0.7, 0, 1, 0.65],
    final: [0.15, 0.68, 0.85, 0.98],
  },
} satisfies Record<string, Partial<Record<'initial' | 'under' | 'beside' | 'final', Box>>>;

/**
 * Template strokes for a syllable or a compatibility jamo, in the unit box
 * and in pen order, grouped per letter (initial, vowel parts, final — a
 * double consonant is two); null when not Hangul.
 */
export function hangulLetters(char: string): Polyline[][] | null {
  const jamo = decomposeHangul(char);
  if (!jamo) {
    if (CONSONANTS[char] || CONSONANT_PAIRS[char]) return consonant(char);
    if (VERTICAL_VOWELS[char]) return [VERTICAL_VOWELS[char]!];
    if (HORIZONTAL_VOWELS[char]) return [HORIZONTAL_VOWELS[char]!];
    const compound = COMPOUND_VOWELS[char];
    if (compound) return [inBox(HORIZONTAL_VOWELS[compound[0]]!, [0, 0.3, 0.7, 1]), inBox(VERTICAL_VOWELS[compound[1]]!, [0.7, 0, 1, 1])];
    return null;
  }
  const [initial, vowel, final] = jamo;
  const compound = COMPOUND_VOWELS[vowel];
  const cls = compound ? 'compound' : VERTICAL_VOWELS[vowel] ? 'vertical' : 'horizontal';
  const layout: Partial<Record<'initial' | 'under' | 'beside' | 'final', Box>> = LAYOUTS[final ? (`${cls}Final` as const) : cls];
  const out = consonant(initial).map((letter) => inBox(letter, layout.initial!));
  if (compound) {
    out.push(inBox(HORIZONTAL_VOWELS[compound[0]]!, layout.under!));
    out.push(inBox(VERTICAL_VOWELS[compound[1]]!, layout.beside!));
  } else if (cls === 'vertical') {
    out.push(inBox(VERTICAL_VOWELS[vowel]!, layout.beside!));
  } else {
    out.push(inBox(HORIZONTAL_VOWELS[vowel]!, layout.under!));
  }
  if (final) out.push(...consonant(final).map((letter) => inBox(letter, layout.final!)));
  return out;
}

/** {@link hangulLetters}, flattened to the syllable's strokes in pen order. */
export function hangulStrokes(char: string): Polyline[] | null {
  return hangulLetters(char)?.flat() ?? null;
}

export const HANGUL_LICENSE = 'Hangul stroke-order templates composed by tegaki (standard jamo stroke order)';

const VIEWBOX = { width: 100, height: 100 };

/** Hangul syllable + compatibility-jamo stroke-order references, composed from jamo templates. */
export function createHangulProvider(): StrokeOrderProvider {
  const cache = new Map<string, ReferenceGlyph | null>();
  return {
    name: 'hangul',
    async get(char: string): Promise<ReferenceGlyph | null> {
      let entry = cache.get(char);
      if (entry === undefined) {
        const letters = hangulLetters(char);
        entry = letters
          ? {
              char,
              strokes: letters.flatMap((strokes, group) =>
                strokes.map((s) => ({ points: s.map(([x, y]) => ({ x: x * VIEWBOX.width, y: y * VIEWBOX.height })), group })),
              ),
              viewBox: VIEWBOX,
              source: 'hangul',
              license: HANGUL_LICENSE,
            }
          : null;
        cache.set(char, entry);
      }
      return entry;
    },
  };
}
