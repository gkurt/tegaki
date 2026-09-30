import type { CSSProperties } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { TegakiPlugin } from 'tegaki/core';
import { Typed } from '../components.tsx';
import { FONTS } from '../fonts.ts';
import { blueprint } from '../plugins/blueprint.ts';
import { chalk } from '../plugins/chalk.ts';
import { ember } from '../plugins/ember.ts';
import { foil } from '../plugins/foil.ts';
import { glitch } from '../plugins/glitch.ts';
import { neon } from '../plugins/neon.ts';
import { stardust } from '../plugins/stardust.ts';
import { watercolor } from '../plugins/watercolor.ts';
import { EASE, HEIGHT, MONO, ramp, WIDTH } from '../theme.ts';
import { Write } from '../Write.tsx';

export const PLUGINS_FRAMES = 270;

const WORD = 'magic';
const BASE_W = 600;
const BASE_H = 360;
const SIZE = 200;

interface Panel {
  name: string;
  plugins: TegakiPlugin[];
  color: string;
  background: string;
  label: string;
  quality: { pixelRatio: number };
}

const PANELS: Panel[] = [
  {
    name: 'neon',
    plugins: [neon()],
    color: '#ff3fd2',
    background: 'radial-gradient(ellipse at 50% 55%, #1c1224 0%, #0a070d 75%)',
    label: '#ff8fe6',
    quality: { pixelRatio: 2.3 },
  },
  {
    name: 'chalk',
    plugins: [chalk()],
    color: '#f4f1ea',
    background: 'radial-gradient(ellipse at 40% 40%, #2f4a3d 0%, #1b2d25 80%)',
    label: '#cfe0d6',
    quality: { pixelRatio: 1.6 },
  },
  {
    name: 'foil',
    plugins: [foil()],
    color: '#c99a3a',
    background: 'radial-gradient(ellipse at 50% 40%, #241a2c 0%, #0f0a14 85%)',
    label: '#e8c27a',
    quality: { pixelRatio: 1.6 },
  },
  {
    name: 'ember',
    plugins: [ember()],
    color: '#ff8a2a',
    background: 'radial-gradient(ellipse at 50% 70%, #2a0f08 0%, #0c0504 80%)',
    label: '#ffb27a',
    quality: { pixelRatio: 1.6 },
  },
  {
    name: 'blueprint',
    plugins: [blueprint()],
    color: '#e8f1ff',
    background:
      'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px) 0 0 / 24px 24px, #11408a',
    label: '#cfe0ff',
    quality: { pixelRatio: 1.1 },
  },
  {
    name: 'watercolor',
    plugins: [watercolor()],
    color: '#1f6fb2',
    background: 'radial-gradient(ellipse at 50% 45%, #fbf7ee 0%, #efe6d4 100%)',
    label: '#8a7f6c',
    quality: { pixelRatio: 1.1 },
  },
  {
    name: 'glitch',
    plugins: [glitch()],
    color: '#eafcff',
    background: 'radial-gradient(ellipse at 50% 50%, #10131c 0%, #050608 80%)',
    label: '#8ff4ff',
    quality: { pixelRatio: 1.1 },
  },
  {
    name: 'stardust',
    plugins: [stardust()],
    color: '#ffffff',
    background: 'radial-gradient(ellipse at 30% 30%, #2a1f5c 0%, #0c0922 60%, #06050f 100%)',
    label: '#c9c1ff',
    quality: { pixelRatio: 1.1 },
  },
];

type Rect = [x: number, y: number, w: number, h: number];

const M = 22; // outer margin once split
const G = 12; // gutter
const grid = (cols: number, rows: number, c: number, r: number): Rect => {
  const w = (WIDTH - 2 * M - (cols - 1) * G) / cols;
  const h = (HEIGHT - 2 * M - (rows - 1) * G) / rows;
  return [M + c * (w + G), M + r * (h + G), w, h];
};

// Where each panel is at each stage: 1, 2, 4 and 8 panels. A panel appears
// out of the edge of the one it splits from.
const FULL: Rect = [0, 0, WIDTH, HEIGHT];
const STAGES: (Rect | null)[][] = [
  [FULL, null, null, null, null, null, null, null],
  [grid(2, 1, 0, 0), grid(2, 1, 1, 0), null, null, null, null, null, null],
  [grid(2, 2, 0, 0), grid(2, 2, 1, 0), grid(2, 2, 0, 1), grid(2, 2, 1, 1), null, null, null, null],
  [
    grid(4, 2, 0, 0),
    grid(4, 2, 2, 0),
    grid(4, 2, 0, 1),
    grid(4, 2, 2, 1),
    grid(4, 2, 1, 0),
    grid(4, 2, 3, 0),
    grid(4, 2, 1, 1),
    grid(4, 2, 3, 1),
  ],
];
// Where a new panel grows from: a sliver at its parent's far edge.
const spawn = (r: Rect, dir: 'right' | 'down'): Rect => (dir === 'right' ? [r[0] + r[2], r[1], 0, r[3]] : [r[0], r[1] + r[3], r[2], 0]);
const SPAWN_DIR: ('right' | 'down')[] = ['right', 'right', 'down', 'down', 'right', 'right', 'right', 'right'];
// Frames each split starts at, and how long it takes.
const SPLITS = [52, 102, 150];
const SPLIT_DUR = 16;
// When each panel's pen starts: as it appears, and all together for the finale.
const APPEAR = [2, SPLITS[0]!, SPLITS[1]!, SPLITS[1]!, SPLITS[2]!, SPLITS[2]!, SPLITS[2]!, SPLITS[2]!];
const UNISON = 206;

const lerpRect = (a: Rect, b: Rect, t: number): Rect => [0, 1, 2, 3].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rect;

function rectAt(i: number, frame: number): Rect | null {
  let rect: Rect | null = STAGES[0]![i]!;
  for (let s = 0; s < SPLITS.length; s++) {
    const t = ramp(frame, SPLITS[s]!, SPLITS[s]! + SPLIT_DUR, EASE.inOut);
    if (t <= 0) break;
    const to = STAGES[s + 1]![i]!;
    if (!to) continue;
    const from = rect ?? spawn(to, SPAWN_DIR[i]!);
    rect = lerpRect(from, to, t);
  }
  return rect;
}

/** One word, eight plugins: the screen splits and splits again, each new panel writing as it opens. */
export const Plugins: React.FC = () => {
  const frame = useCurrentFrame();
  const split = ramp(frame, SPLITS[0]!, SPLITS[0]! + SPLIT_DUR, EASE.inOut);
  return (
    <AbsoluteFill style={{ background: '#050505' }}>
      {PANELS.map((p, i) => {
        const rect = rectAt(i, frame);
        if (!rect || rect[2] < 1 || rect[3] < 1) return null;
        const [x, y, w, h] = rect;
        const scale = Math.min(w / BASE_W, h / BASE_H, 2.3);
        const unison = frame >= UNISON;
        const leave = ramp(frame, PLUGINS_FRAMES - 32 + i * 1.5, PLUGINS_FRAMES - 16 + i * 1.5, EASE.in);
        const style: CSSProperties = {
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          overflow: 'hidden',
          borderRadius: 18 * split,
          background: p.background,
          transform: `translateY(${leave * 60}px) scale(${1 - leave * 0.08})`,
          opacity: 1 - leave,
        };
        return (
          <div key={p.name} style={style}>
            <div
              style={{
                position: 'absolute',
                left: w / 2 - BASE_W / 2,
                top: h / 2 - BASE_H / 2,
                width: BASE_W,
                height: BASE_H,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `scale(${scale})`,
              }}
            >
              <Write
                key={unison ? 'unison' : 'first'}
                font={FONTS.caveat}
                text={WORD}
                from={unison ? UNISON : APPEAR[i]}
                frames={unison ? 44 : 46}
                size={SIZE}
                color={p.color}
                plugins={p.plugins}
                quality={p.quality}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                left: 22,
                bottom: 18,
                fontFamily: MONO,
                fontSize: i === 0 && split < 0.5 ? 30 : 17,
                color: p.label,
                opacity: 0.85,
              }}
            >
              {i === 0 && split < 0.5 ? <Typed text="plugins={[neon()]}" at={10} cps={30} /> : `${p.name}()`}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
