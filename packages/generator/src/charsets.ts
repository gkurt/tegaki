// Pre-defined character sets for common writing systems. Used as the default
// `--chars` set for the corresponding bundled font, and exposed as presets in
// the website's generator UI so users can pick a baseline subset for their own
// bundles without having to type out every codepoint by hand.
//
// Each non-Latin set ends with the Latin baseline so mixed-script text (numbers,
// brand names, English fragments inside Hebrew/Arabic/Devanagari/Japanese
// prose) renders without falling back to the full font.

import { DEFAULT_CHARS } from './constants.ts';

// ── Hebrew ────────────────────────────────────────────────────────────────
// 22 base letters + 5 final forms (ך ם ן ף ץ). Niqqud (vowel marks) are
// omitted — most modern Hebrew typesetting treats them as optional.
const HEBREW_BASE = 'אבגדהוזחטיכלמנסעפצקרשת';
const HEBREW_FINAL = 'ךםןףץ';
export const HEBREW_CHARS = HEBREW_BASE + HEBREW_FINAL + DEFAULT_CHARS;

// ── Arabic ────────────────────────────────────────────────────────────────
// 28 base letters + alef variants (آ أ إ) + ya/hamza variants (ى ئ) +
// ta marbuta (ة) + standalone hamza (ء) + 8 harakat (vowel/sukun marks) +
// Arabic-Indic digits. Positional variants (init/medi/fina/isol) are
// generated at shape time from these via the harfbuzz shaper.
const ARABIC_BASE = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const ARABIC_VARIANTS = 'آأإىئةء';
const ARABIC_HARAKAT = 'ًٌٍَُِّْ';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const ARABIC_CHARS = ARABIC_BASE + ARABIC_VARIANTS + ARABIC_HARAKAT + ARABIC_DIGITS + DEFAULT_CHARS;

// ── Japanese ──────────────────────────────────────────────────────────────
// Hiragana: 46 gojūon + 25 dakuten/handakuten + 10 small/yōon = 81.
const HIRAGANA =
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん' +
  'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ' +
  'ぁぃぅぇぉっゃゅょゎ';

// Katakana: same structure as hiragana.
const KATAKANA =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ' +
  'ァィゥェォッャュョヮ';

// Common Japanese punctuation. ー (long-vowel mark) and ・ (middle dot) are
// listed here rather than in KATAKANA so they're grouped with other marks.
const JP_PUNCT = '、。「」『』（）〜ー・…々';

// Kyōiku kanji, grades 1–2 of the Japanese Ministry of Education list (240
// glyphs total — the foundational subset taught in years 1–2 of elementary
// school). This is the smallest commonly-cited "essential kanji" boundary
// that's still useful for everyday prose; users who need more coverage can
// regenerate via the website with `--chars true` or a custom set.
const KANJI_GRADE_1 =
  '一二三四五六七八九十百千上下左右中大小月日年早木林山川土空田天生花草虫犬人名女男子目耳口手足見音力気円入出立休先夕本文字学校村町森正水火玉王石竹糸貝車金雨赤青白';

const KANJI_GRADE_2 =
  '引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話';

const KANJI = KANJI_GRADE_1 + KANJI_GRADE_2;

export const JAPANESE_CHARS = HIRAGANA + KATAKANA + JP_PUNCT + KANJI + DEFAULT_CHARS;

// ── Devanagari ────────────────────────────────────────────────────────────
// Independent vowels (16) + 33 base consonants + 7 nukta-form consonants
// commonly used in Hindi/Urdu loanwords (क़ ख़ ग़ ज़ ड़ ढ़ फ़) + matras (dependent
// vowel signs) + anusvara/visarga/candrabindu/nukta + virama (halant) +
// Devanagari digits. Conjuncts (consonant + virama + consonant) are formed
// at shape time via the harfbuzz shaper from these base codepoints.
const DEVANAGARI_VOWELS = 'अआइईउऊऋऌऍऎएऐऑऒओऔ';
const DEVANAGARI_CONSONANTS = 'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह';
const DEVANAGARI_NUKTA_CONSONANTS = 'क़ख़ग़ज़ड़ढ़फ़';
const DEVANAGARI_MATRAS = 'ािीुूृॄॅॆेैॉॊोौ';
const DEVANAGARI_MARKS = 'ंःँ़्';
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
export const DEVANAGARI_CHARS =
  DEVANAGARI_VOWELS +
  DEVANAGARI_CONSONANTS +
  DEVANAGARI_NUKTA_CONSONANTS +
  DEVANAGARI_MATRAS +
  DEVANAGARI_MARKS +
  DEVANAGARI_DIGITS +
  DEFAULT_CHARS;

/**
 * Named presets for the generator UI. Each preset is the default `--chars`
 * for its writing system; clicking one in the UI replaces the user's char
 * set with the preset.
 */
export const CHARSET_PRESETS: { name: string; chars: string }[] = [
  { name: 'Latin', chars: DEFAULT_CHARS },
  { name: 'Hebrew', chars: HEBREW_CHARS },
  { name: 'Arabic', chars: ARABIC_CHARS },
  { name: 'Devanagari', chars: DEVANAGARI_CHARS },
  { name: 'Japanese', chars: JAPANESE_CHARS },
];
