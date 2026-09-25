import { useEffect, useRef, useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import { type FontName, loadFont, useFont, useInView } from './shared.ts';

interface Script {
  name: string;
  lang: string;
  native: string;
  font: FontName;
  /** "Handwriting", in the script. Every character is in the bundle's set. */
  word: string;
  gloss: string;
  note: string;
  dir?: 'rtl';
  /** Clip the pen to the letterform — for heavy display faces whose round caps would bulge past it. */
  clip?: number;
}

const SCRIPTS: Script[] = [
  {
    name: 'Latin',
    lang: 'en',
    native: 'Latin',
    font: 'Parisienne',
    word: 'handwriting',
    gloss: 'handwriting',
    note: 'Contextual alternates and ligatures, shaped by HarfBuzz exactly as the browser sets them.',
  },
  {
    name: 'Hebrew',
    lang: 'he',
    native: 'עברית',
    font: 'Suez One',
    word: 'כתב יד',
    gloss: 'ktav yad',
    note: 'Right to left, one letter after another.',
    dir: 'rtl',
    clip: 1.6,
  },
  {
    name: 'Arabic',
    lang: 'ar',
    native: 'العربية',
    font: 'Amiri',
    word: 'خط اليد',
    gloss: 'khaṭṭ al-yad',
    note: 'Joined letters in their initial, medial and final forms, and the dots come last.',
    dir: 'rtl',
  },
  {
    name: 'Devanagari',
    lang: 'hi',
    native: 'देवनागरी',
    font: 'Tillana',
    word: 'हस्तलेखन',
    gloss: 'hastalekhan',
    note: 'The letters hang first; the headline is pulled across the whole word after them.',
  },
  {
    name: 'Bengali',
    lang: 'bn',
    native: 'বাংলা',
    font: 'Atma',
    word: 'হাতের লেখা',
    gloss: 'hater lekha',
    note: 'The matra runs along each word in a single stroke.',
  },
  {
    name: 'Japanese',
    lang: 'ja',
    native: '日本語',
    font: 'Klee One',
    word: '手書き',
    gloss: 'tegaki',
    note: 'Every kanji in its textbook stroke order, from KanjiVG.',
  },
  {
    name: 'Korean',
    lang: 'ko',
    native: '한국어',
    font: 'Nanum Pen Script',
    word: '손글씨',
    gloss: 'son-geulssi',
    note: 'Each syllable built jamo by jamo, the way it is taught.',
  },
  {
    name: 'Chinese',
    lang: 'zh-Hans',
    native: '中文',
    font: 'LXGW WenKai',
    word: '手写字',
    gloss: 'shǒuxiězì',
    note: 'Stroke order for Simplified Chinese, from Make Me a Hanzi.',
  },
];

/** Every word takes the same time to write, whatever its stroke count. */
const DRAW_S = 3.4;
const HOLD_MS = 1600;

/** One word — "handwriting" — written in each script in turn. */
export function Scripts() {
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useInView(rootRef, { once: true, rootMargin: '400px 0px' });
  const visible = useInView(rootRef, { threshold: 0.25 });
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const script = SCRIPTS[index]!;
  const font = useFont(near ? script.font : null);

  // Warm every bundle, one at a time in carousel order, so each script's font
  // is in before its turn — the CJK ones are megabytes, more than one turn fetches.
  useEffect(() => {
    if (!near) return;
    SCRIPTS.reduce<Promise<unknown>>((chain, s) => chain.then(() => loadFont(s.font)), Promise.resolve());
  }, [near]);

  // Hold the finished word, then move on — only while someone is watching.
  useEffect(() => {
    if (!done || !visible) return;
    const timer = setTimeout(() => {
      setDone(false);
      setIndex((i) => (i + 1) % SCRIPTS.length);
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [done, visible]);

  const select = (i: number) => {
    setDone(false);
    setIndex(i);
  };

  return (
    <div ref={rootRef} className="scripts">
      <div className="scripts-stage">
        <div className="scripts-word">
          {font ? (
            <TegakiRenderer
              key={index}
              lang={script.lang}
              font={font}
              direction={script.dir}
              time={{ mode: 'uncontrolled', duration: DRAW_S, delay: 0.2, playing: visible }}
              quality={{ smoothing: true, clipText: script.clip ?? 1.3 }}
              onComplete={() => setDone(true)}
            >
              {script.word}
            </TegakiRenderer>
          ) : (
            <span className="scripts-loading">Filling the pen with {script.font}…</span>
          )}
        </div>
        <div className="scripts-caption" key={index}>
          <span className="scripts-gloss">
            {script.native !== script.name && (
              <span className="scripts-native" lang={script.lang}>
                {script.native}
              </span>
            )}
            <em>“{script.gloss}”</em>
          </span>
          <p>{script.note}</p>
          <code>{script.font}</code>
        </div>
      </div>
      <div className="scripts-tabs" role="tablist" aria-label="Writing system">
        {SCRIPTS.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? 'active' : undefined}
            onClick={() => select(i)}
          >
            <span>{s.name}</span>
            {i === index && <span className="scripts-tab-progress" data-done={done || undefined} />}
          </button>
        ))}
      </div>
    </div>
  );
}
