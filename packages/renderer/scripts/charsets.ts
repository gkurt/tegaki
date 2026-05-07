// Character sets used to subset each bundled font. Kept here (not in the
// generator package) because they're a *bundle* policy decision — what we ship
// pre-generated — rather than a property of the pipeline itself.
//
// Each non-Latin set also includes the full Latin baseline so mixed-script text
// (numbers, brand names, English fragments inside Hebrew/Arabic/Japanese prose)
// renders without having to fall through to the full font.

/** Mirrors `DEFAULT_CHARS` in tegaki-generator. */
export const LATIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?\'"-()/\\@#$%&*+=<>~`^_|';

// ── Hebrew ────────────────────────────────────────────────────────────────
// 22 base letters + 5 final forms (ך ם ן ף ץ). Niqqud (vowel marks) are
// omitted — Suez One barely styles them and they're optional in modern text.
const HEBREW_BASE = 'אבגדהוזחטיכלמנסעפצקרשת';
const HEBREW_FINAL = 'ךםןףץ';
export const HEBREW_CHARS = HEBREW_BASE + HEBREW_FINAL + LATIN_CHARS;

// ── Arabic ────────────────────────────────────────────────────────────────
// 28 base letters + alef variants (آ أ إ) + ya/hamza variants (ى ئ) +
// ta marbuta (ة) + standalone hamza (ء) + 8 harakat (vowel/sukun marks) +
// Arabic-Indic digits. Positional variants (init/medi/fina/isol) are
// generated at shape time from these via the harfbuzz shaper.
const ARABIC_BASE = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const ARABIC_VARIANTS = 'آأإىئةء';
const ARABIC_HARAKAT = 'ًٌٍَُِّْ';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const ARABIC_CHARS = ARABIC_BASE + ARABIC_VARIANTS + ARABIC_HARAKAT + ARABIC_DIGITS + LATIN_CHARS;

// ── Japanese ──────────────────────────────────────────────────────────────
// Hiragana: 46 gojūon + 25 dakuten/handakuten + 10 small/yōon = 81.
const HIRAGANA =
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん' +
  'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ' +
  'ぁぃぅぇぉっゃゅょゎ';

// Katakana: same structure as hiragana, plus the long-vowel mark (ー) and
// middle dot (・) that are conventionally counted with katakana.
const KATAKANA =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ' +
  'ァィゥェォッャュョヮ';

// Common Japanese punctuation. ー and ・ are listed here rather than in
// KATAKANA so they're grouped with other punctuation marks.
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

export const JAPANESE_CHARS = HIRAGANA + KATAKANA + JP_PUNCT + KANJI + LATIN_CHARS;
