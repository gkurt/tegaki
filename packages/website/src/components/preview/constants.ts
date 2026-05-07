import type { SkeletonMethod } from 'tegaki-generator';

export type PreviewMode = 'glyph' | 'text';

export type Stage =
  | 'outline'
  | 'flattened'
  | 'bitmap'
  | 'skeleton'
  | 'overlay'
  | 'distance'
  | 'traced'
  | 'curvature'
  | 'strokes'
  | 'animation'
  | 'final';

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'outline', label: 'Outline' },
  { key: 'flattened', label: 'Flattened' },
  { key: 'bitmap', label: 'Bitmap' },
  { key: 'skeleton', label: 'Skeleton' },
  { key: 'overlay', label: 'Overlay' },
  { key: 'distance', label: 'Distance' },
  { key: 'traced', label: 'Traced' },
  { key: 'curvature', label: 'Curvature' },
  { key: 'strokes', label: 'Strokes' },
  { key: 'animation', label: 'Animation' },
  { key: 'final', label: 'Final' },
];

/**
 * "Handwriting is awesome" in the language associated with each example font.
 * Clicking an example font button populates the text preview with this phrase
 * in the corresponding script so the user can see the font render its native text.
 * Fonts not listed here fall back to the English phrase.
 */
export const EXAMPLE_FONT_TEXTS: Record<string, string> = {
  'Noto Sans JP': '手書きは素晴らしい',
  'Shippori Mincho B1': '手書きは素晴らしい',
  // Klee One's bundled charset is Kyōiku grade 1–2 only; `素` (grade 5) would
  // miss the subset, so use a phrase that stays inside the bundled kanji.
  'Klee One': '手書きは楽しい',
  'Noto Sans SC': '手写真棒',
  'Ma Shan Zheng': '手写真棒',
  'Noto Sans KR': '손글씨는 멋져요',
  'Nanum Myeongjo': '손글씨는 멋져요',
  Rubik: 'الكتابة اليدوية رائعة',
  Amiri: 'الكتابة اليدوية رائعة',
  Cardo: 'כתב היד מדהים',
  'Suez One': 'כתב היד מדהים',
  Tillana: 'हस्तलेखन अद्भुत है',
  'EB Garamond': 'Η χειρογραφία είναι υπέροχη',
};

export const DEFAULT_EXAMPLE_FONT_TEXT = 'Handwriting is awesome';

/**
 * Per-writing-system sample text for the Text Preview tab. Independent of the
 * font preset list — clicking a preset replaces the textarea so the user can
 * exercise a specific script regardless of which font is currently loaded.
 * Japanese uses only Kyōiku grade 1–2 kanji so it stays inside the bundled
 * Klee One subset; the other scripts are short, well-formed phrases.
 */
export const TEXT_PRESETS: { name: string; text: string }[] = [
  { name: 'English', text: 'Handwriting is awesome' },
  { name: 'Hebrew', text: 'כתב היד מדהים' },
  { name: 'Arabic', text: 'الكتابة اليدوية رائعة' },
  { name: 'Devanagari', text: 'हस्तलेखन अद्भुत है' },
  { name: 'Japanese', text: '手書きは楽しい' },
];

export const SKELETON_METHODS: { value: SkeletonMethod; label: string }[] = [
  { value: 'zhang-suen', label: 'Zhang-Suen' },
  { value: 'guo-hall', label: 'Guo-Hall' },
  { value: 'lee', label: 'Lee' },
  { value: 'medial-axis', label: 'Medial Axis' },
  { value: 'thin', label: 'Morphological Thin' },
  { value: 'voronoi', label: 'Voronoi' },
];

export type EasingPreset = { key: string; label: string; fn: ((t: number) => number) | undefined };

export const EASING_PRESETS: EasingPreset[] = [
  { key: 'default', label: 'Default', fn: undefined },
  { key: 'linear', label: 'Linear', fn: (t) => t },
  { key: 'ease-out-quad', label: 'Ease Out Quad', fn: (t) => 1 - (1 - t) * (1 - t) },
  { key: 'ease-out-cubic', label: 'Ease Out Cubic', fn: (t) => 1 - (1 - t) ** 3 },
  { key: 'ease-out-expo', label: 'Ease Out Expo', fn: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)) },
  { key: 'ease-in-quad', label: 'Ease In Quad', fn: (t) => t * t },
  { key: 'ease-in-cubic', label: 'Ease In Cubic', fn: (t) => t ** 3 },
  { key: 'ease-in-out-quad', label: 'Ease In-Out Quad', fn: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) },
  { key: 'ease-in-out-cubic', label: 'Ease In-Out Cubic', fn: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) },
];

const EASING_MAP = new Map(EASING_PRESETS.map((p) => [p.key, p.fn]));

export function getEasingFn(key: string): ((t: number) => number) | undefined {
  return EASING_MAP.get(key);
}
