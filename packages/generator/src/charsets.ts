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

// ── Korean ────────────────────────────────────────────────────────────────
// ~650 most-frequent precomposed Hangul syllables (U+AC00–U+D7A3), capped so
// the generator's Google Fonts &text= request returns a real subset rather
// than the full font (the css2 subset→full cliff is ~6.5 KB of encoded
// &text=, i.e. ~670 Hangul syllables; we sit safely below it), + 40 modern
// compatibility jamo: 19 leading consonants (ㄱ–ㅎ) + 21 vowels (ㅏ–ㅣ).
// Compound batchim clusters (ㄳㄵ… U+3133, U+3135, …) are omitted — they're
// covered in-context by the precomposed syllables and are rarely written as
// isolated jamo. Syllable set derived from KS X 1001 common band ∪ top-N
// Korean-Wikipedia frequency; see scripts/derive-korean-chars.ts (corpus +
// method). Hangul is precomposed in Unicode, so no shaper is needed. Korean
// uses standard ASCII punctuation (already in DEFAULT_CHARS), so no
// Korean-specific punctuation block.
const KOREAN_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ' + 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'; // 19 + 21 = 40
const KOREAN_SYLLABLES =
  '가각간갈감갑값갔강갖같개객거건걸검것게겐겠겨격견결겸겼경계고곡곤골곱곳공과관광괴교구국군굴궁권귀규균그극근글금급기긴길김까깨께꾸끌끝끼나낙난날남났낮내낸냈냐너널넘네넷녀년념노녹논놀농높놓누눈뉴늄느는늘능니닉닌님다단달담답당대더덕던덜데덴델도독돈돌동됐되된될됨두둔둘둥뒤드득든들등디딩따딸때떠떤떨또뜻라락란람랍랑래랙랜램략량러런럼럽렇레렉렌려력련렬렸령례로록론롤롭롯료룡루룹류륙률르른를름릉리릭린릴림립링마막만많말망맞맡매맥맨맹머먹먼메멘며면멸명몇모목몬몰못몽묘무문물뮤므미민밀밍및바박밖반받발밝방배백밴버번벌범법베벤벨벽변별병보복본볼봇봉부북분불붕붙브블비빈빌빛빠뿐사삭산살삼상새색생샤서석선설섬섭성세센셀셔션소속손솔송쇄쇼수숙순술숨숭슈스슨슬습승시식신실심십싱싸쌍써쓰씨아악안않알암압았앙앞애액앤앨앵야약양어억언얻얼엄업없었에엔엘여역연열염였영예옛오옥온올옮옹와완왔왕왜외왼요욕용우욱운울움웅워원월웠웨웹위윈윌유육윤율융으은을음읍응의이익인일임입있잉자작잔잘잠잡장재쟁저적전절점접정제젝젠젤져졌조족존졸종좋좌죄주죽준줄중즈즉즌즘증지직진질짐집징짜째쪽차착찬찰참창찾채책처척천철첫청체쳐쳤초촉촌총최추축춘출충취츠측층치칙친칠침칭카칸칼캐캠커컨컬컴컵케켜켰코콘콜콩쿄쿠큐크큰클키킨킬킹타탁탄탈탐탑탕태택터턴털테텍텐텔템토톤톨통퇴투튀튜트특틀티틴팀팅파판팔패퍼페펜편평폐포폭폰폴표푸풀품풍퓨프플피픽핀필하학한할함합항해핵했행향허헌험헤헨헬혀혁현혈협형혜호혹혼홀홈홍화확환활황회획효후훈휘휴흐흑흔흥희히힌힘';
export const KOREAN_CHARS = KOREAN_SYLLABLES + KOREAN_JAMO + DEFAULT_CHARS;

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
  { name: 'Korean', chars: KOREAN_CHARS },
];
