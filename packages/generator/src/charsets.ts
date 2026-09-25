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

// ── Bengali ───────────────────────────────────────────────────────────────
// Independent vowels (12) + 33 base consonants + 3 nukta-form consonants
// (ড় ঢ় য়) + matras (dependent vowel signs) + anusvara/visarga/candrabindu/
// virama + Bengali digits. Conjuncts (consonant + virama + consonant) are
// formed at shape time via the harfbuzz shaper from these base codepoints,
// same as Devanagari.
const BENGALI_VOWELS = 'অআইঈউঊঋএঐওঔ';
const BENGALI_CONSONANTS = 'কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহ';
const BENGALI_NUKTA_CONSONANTS = 'ড়ঢ়য়';
const BENGALI_MATRAS = 'ািীুূৃেৈোৌ';
const BENGALI_MARKS = 'ংঃঁ্';
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';
export const BENGALI_CHARS =
  BENGALI_VOWELS + BENGALI_CONSONANTS + BENGALI_NUKTA_CONSONANTS + BENGALI_MATRAS + BENGALI_MARKS + BENGALI_DIGITS + DEFAULT_CHARS;

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

// ── Simplified Chinese ────────────────────────────────────────────────────
// The 1000 most frequent characters of Jun Da's Modern Chinese Character
// Frequency List (modern-text list, lingua.mtsu.edu/chinese-computing/
// statistics/char/list.php?Which=MO), in frequency order: 89% of the
// corpus's running text. Past the Korean set's Google Fonts &text= cliff, so a
// Google-hosted family comes back whole; the CLI's --font-file subsets locally.
// Plus full-width Chinese punctuation. Stroke order comes from Make Me a
// Hanzi (`--han-locale zh`).
const HANZI_TOP_1000 =
  '的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实' +
  '日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员' +
  '解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象' +
  '完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调' +
  '深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列' +
  '武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值' +
  '仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷' +
  '洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央' +
  '户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康' +
  '虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶';
const ZH_PUNCT = '，。、；：？！“”‘’（）《》【】…—·';
export const SIMPLIFIED_CHINESE_CHARS = HANZI_TOP_1000 + ZH_PUNCT + DEFAULT_CHARS;

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
  { name: 'Bengali', chars: BENGALI_CHARS },
  { name: 'Japanese', chars: JAPANESE_CHARS },
  { name: 'Korean', chars: KOREAN_CHARS },
  { name: 'Simplified Chinese', chars: SIMPLIFIED_CHINESE_CHARS },
];
