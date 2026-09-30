import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Rise } from '../components.tsx';
import { type Bundle, FONTS } from '../fonts.ts';
import { C, EASE, keys, MONO, ramp, SERIF } from '../theme.ts';
import { Write } from '../Write.tsx';

interface Cell {
  lang: string;
  font: Bundle;
  name: string;
  text: string;
  size: number;
  rtl?: boolean;
}

const CELLS: Cell[][] = [
  [
    { lang: 'FR', font: FONTS.parisienne, name: 'Parisienne', text: 'bonjour', size: 104 },
    { lang: 'JA', font: FONTS.kleeOne, name: 'Klee One', text: 'こんにちは', size: 76 },
    { lang: 'AR', font: FONTS.amiri, name: 'Amiri', text: 'مرحبا', size: 110, rtl: true },
    { lang: 'HI', font: FONTS.tillana, name: 'Tillana', text: 'नमस्ते', size: 100 },
  ],
  [
    { lang: 'ES', font: FONTS.tangerine, name: 'Tangerine', text: 'hola', size: 150 },
    { lang: 'EN', font: FONTS.caveat, name: 'Caveat', text: 'hello', size: 120 },
    { lang: 'ZH', font: FONTS.lxgwWenkai, name: 'LXGW WenKai', text: '你好', size: 100 },
    { lang: 'KO', font: FONTS.nanumPenScript, name: 'Nanum Pen', text: '반가워요', size: 112 },
  ],
  [
    { lang: 'HE', font: FONTS.suezOne, name: 'Suez One', text: 'שלום', size: 96, rtl: true },
    { lang: 'BN', font: FONTS.atma, name: 'Atma', text: 'নমস্কার', size: 86 },
    { lang: 'IT', font: FONTS.italianno, name: 'Italianno', text: 'ciao', size: 140 },
    { lang: 'DE', font: FONTS.hersheyScript, name: 'Hershey Script', text: 'hallo', size: 104 },
  ],
];

const CARD_W = 392;
const CARD_H = 232;
const GAP = 22;
const GRID_W = 4 * CARD_W + 3 * GAP;
const GRID_H = 3 * CARD_H + 2 * GAP;
// The card the camera starts on: "hello".
const FOCUS = { row: 1, col: 1 };
const HQ = { pixelRatio: 2 };

export const SCRIPTS_FRAMES = 138;

/** Hello in twelve hands: the camera pulls back from one card as the rest write in a ripple. */
export const Scripts: React.FC = () => {
  const frame = useCurrentFrame();
  // The focused card's center, relative to the grid's center.
  const fx = (FOCUS.col - 1.5) * (CARD_W + GAP);
  const fy = (FOCUS.row - 1) * (CARD_H + GAP);
  const pull = ramp(frame, 4, 70, EASE.inOut);
  const scale = 2.1 + (0.94 - 2.1) * pull;
  const drift = keys(frame, [70, SCRIPTS_FRAMES], [0.94, 0.9], EASE.soft);
  const s = frame > 70 ? drift : scale;
  const tx = -fx * (1 - pull);
  const ty = -fy * (1 - pull) - 40 * pull;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${C.paper} 0%, ${C.paperDeep} 100%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: GRID_W,
            height: GRID_H,
            position: 'relative',
            transform: `scale(${s}) translate(${tx}px, ${ty}px)`,
          }}
        >
          {CELLS.flatMap((row, r) =>
            row.map((cell, c) => {
              const d = Math.hypot(r - FOCUS.row, c - FOCUS.col);
              const at = 6 + d * 11;
              const pop = ramp(frame, at - 6, at + 14, EASE.out);
              return (
                <div
                  key={cell.lang}
                  style={{
                    position: 'absolute',
                    left: c * (CARD_W + GAP),
                    top: r * (CARD_H + GAP),
                    width: CARD_W,
                    height: CARD_H,
                    borderRadius: 22,
                    background: C.card,
                    border: `1px solid ${C.rule}`,
                    boxShadow: '0 1px 1px rgb(60 40 10 / 0.04), 0 18px 40px -18px rgb(60 40 10 / 0.25)',
                    opacity: d === 0 ? 1 : pop,
                    transform: `translateY(${(1 - pop) * 30}px) scale(${0.96 + 0.04 * pop})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 18,
                      left: 22,
                      right: 22,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: MONO,
                      fontSize: 13,
                      letterSpacing: 2.5,
                      textTransform: 'uppercase',
                      color: C.muted,
                    }}
                  >
                    <span style={{ color: d === 0 ? C.seal : C.muted }}>{cell.lang}</span>
                    <span>{cell.name}</span>
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <Write
                      font={cell.font}
                      text={cell.text}
                      from={at}
                      frames={46}
                      size={cell.size}
                      color={C.ink}
                      quality={HQ}
                      style={{ direction: cell.rtl ? 'rtl' : 'ltr' }}
                    />
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 70 }}>
        <Rise at={78} style={{ fontFamily: SERIF, fontSize: 64, color: C.ink, letterSpacing: -0.5 }}>
          Any font. <span style={{ fontStyle: 'italic', color: C.seal }}>Every script.</span>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
