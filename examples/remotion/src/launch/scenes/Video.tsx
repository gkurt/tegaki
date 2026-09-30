import type { ReactNode } from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { glowPlugin } from 'tegaki/core';
import { Cursor, cursorAt } from '../components.tsx';
import { FONTS } from '../fonts.ts';
import { C, EASE, MONO, ramp, SANS, SERIF } from '../theme.ts';
import { playhead, SCENE, VIDEO } from '../timing.ts';
import { Write } from '../Write.tsx';

const VIDEO_FRAMES = SCENE.video.frames;

// The edit being made: six seconds of dusk with a title and a subtitle.
const EDIT = VIDEO.edit;
const TITLE_AT = VIDEO.titleAt;
const SUB_AT = VIDEO.subAt;

// Layout.
const MON = { x: 48, y: 44, w: 1152, h: 648 };
const SIDE = { x: 1248, y: 44, w: 624 };
const TL = { y: 736, h: 300, x0: 196, x1: 1872 };
const tx = (t: number) => TL.x0 + (t / EDIT) * (TL.x1 - TL.x0);
const RENDER = { x: SIDE.x, y: 574, w: SIDE.w, h: 64 };

const GRAB = VIDEO.grab;
const DROP = VIDEO.drop;
const RENDER_AT = VIDEO.render;

const TITLE_PLUGINS = [glowPlugin({ radius: 0.06, color: 'rgba(40, 10, 30, 0.55)' })];
const HQ = { pixelRatio: 1.25 };

/** A dusk that moves with the edit's time: sky, sun, hills and a pagoda, pushed in slowly. */
const Footage: React.FC<{ t: number }> = ({ t }) => {
  const push = 1 + (t / EDIT) * 0.08;
  const sun = 360 + (t / EDIT) * 40;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#1a1033' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: '50% 70%' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, #1b1846 0%, #4b2a6b 30%, #c2506a 58%, #f39a5a 74%, #ffd08a 86%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 700 - 110,
            top: sun - 110,
            width: 220,
            height: 220,
            borderRadius: 999,
            background: 'radial-gradient(circle, #fff4d6 0%, #ffd08a 45%, rgba(255,170,100,0) 70%)',
            filter: 'blur(1px)',
          }}
        />
        <svg width={MON.w} height={MON.h} viewBox={`0 0 ${MON.w} ${MON.h}`} style={{ position: 'absolute', inset: 0 }}>
          <path
            d="M0 470 C 160 400, 260 430, 380 390 S 620 350, 760 410 S 1000 380, 1152 420 L 1152 648 L 0 648 Z"
            fill="#6b3b73"
            opacity={0.75}
          />
          <path d="M0 520 C 200 470, 340 500, 520 460 S 820 470, 980 440 S 1100 470, 1152 460 L 1152 648 L 0 648 Z" fill="#43244f" />
          {/* A five-tiered pagoda. */}
          <g fill="#1e1127" transform="translate(250 262)">
            <rect x="-4" y="-80" width="8" height="90" />
            {[0, 1, 2, 3, 4].map((i) => {
              const y = 40 + i * 58;
              const w = 70 + i * 16;
              return (
                <g key={i}>
                  <path
                    d={`M ${-w} ${y} Q ${-w * 0.5} ${y - 6} 0 ${y - 26} Q ${w * 0.5} ${y - 6} ${w} ${y} Q ${w * 0.6} ${y + 2} ${-w * 0.6} ${y + 2} Z`}
                  />
                  <rect x={-w * 0.45} y={y} width={w * 0.9} height={36} />
                </g>
              );
            })}
          </g>
          <path d="M0 580 C 240 540, 420 570, 640 550 S 1000 560, 1152 540 L 1152 648 L 0 648 Z" fill="#1e1127" />
          {/* Birds crossing. */}
          {[0, 1, 2].map((i) => {
            const bx = 820 - t * 60 - i * 38;
            const by = 190 + i * 16 + Math.sin(t * 3 + i) * 4;
            const flap = Math.sin(t * 9 + i * 2) * 5;
            return (
              <path
                key={i}
                d={`M ${bx - 10} ${by - flap} Q ${bx - 4} ${by - 2} ${bx} ${by} Q ${bx + 4} ${by - 2} ${bx + 10} ${by - flap}`}
                stroke="#2a1633"
                strokeWidth={2.4}
                fill="none"
              />
            );
          })}
        </svg>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.45) 100%)',
        }}
      />
    </div>
  );
};

const Code: React.FC<{ live: number; hot: number }> = ({ live, hot }) => {
  const k = (s: string) => <span style={{ color: '#ff8a7a' }}>{s}</span>;
  const tag = (s: string) => <span style={{ color: '#8fc7ff' }}>{s}</span>;
  const str = (s: string) => <span style={{ color: '#b8e6a0' }}>{s}</span>;
  const dim = (s: ReactNode) => <span style={{ color: '#6f6a62' }}>{s}</span>;
  const line = (children: ReactNode, glow = 0) => (
    <div style={{ position: 'relative', padding: '0 20px', height: 38, display: 'flex', alignItems: 'center' }}>
      <div style={{ position: 'absolute', inset: '2px 8px', borderRadius: 6, background: `rgba(255, 106, 77, ${0.16 * glow})` }} />
      <span style={{ position: 'relative' }}>{children}</span>
    </div>
  );
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 22,
        color: C.cream,
        background: '#191816',
        borderRadius: 14,
        padding: '18px 0',
        border: `1px solid ${C.nightRule}`,
      }}
    >
      {line(
        <>
          {k('const')} frame = {tag('useCurrentFrame')}();
        </>,
      )}
      {line('')}
      {line(tag('<TegakiRenderer'))}
      {line(
        <>
          &nbsp;&nbsp;font={'{'}parisienne{'}'}
        </>,
      )}
      {line(<>&nbsp;&nbsp;text={str('"Kyoto, day one"')}</>)}
      {line(
        <>
          &nbsp;&nbsp;time={'{'}frame / fps{'}'} {dim(`// ${live.toFixed(2)}s`)}
        </>,
        hot,
      )}
      {line(tag('/>'))}
    </div>
  );
};

/** Made for video: the title writes with the playhead — dragged back it un-writes, forward it catches up — then renders. */
export const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const T = playhead(frame);
  const enter = ramp(frame, 4, 22, EASE.out);
  const dragging = frame >= GRAB && frame < DROP ? 1 : 0;
  const cur = cursorAt(frame, [
    [30, 1500, 1000],
    [GRAB - 4, tx(playhead(GRAB)), TL.y + 18],
    [GRAB, tx(playhead(GRAB)), TL.y + 18, true],
    [VIDEO.back, tx(0.75), TL.y + 18],
    [DROP, tx(4.1), TL.y + 18],
    [RENDER_AT - 4, RENDER.x + 150, RENDER.y + RENDER.h / 2],
    [RENDER_AT, RENDER.x + 150, RENDER.y + RENDER.h / 2, true],
    [VIDEO_FRAMES, RENDER.x + 260, RENDER.y + 160],
  ]);
  // Held down while dragging.
  const down = dragging ? 0.7 : cur.down;
  const render = ramp(frame, RENDER_AT + 2, VIDEO.rendered, EASE.inOut);
  const done = frame >= VIDEO.rendered;
  const titleT = T - TITLE_AT;
  const subT = T - SUB_AT;

  return (
    <AbsoluteFill style={{ background: '#0f0e0d', opacity: ramp(frame, 0, 5, EASE.out) }}>
      <AbsoluteFill style={{ opacity: enter }}>
        {/* Monitor */}
        <div
          style={{
            position: 'absolute',
            left: MON.x,
            top: MON.y,
            width: MON.w,
            height: MON.h,
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 30px 60px -20px rgba(0,0,0,0.8)',
            transform: `translateY(${(1 - enter) * 30}px)`,
          }}
        >
          <Footage t={T} />
          <div
            style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <Write
              font={FONTS.parisienne}
              text="Kyoto, day one"
              time={Math.max(0, Math.min(1, titleT / VIDEO.titleSeconds))}
              unit="progress"
              size={132}
              color="#fff8ee"
              plugins={TITLE_PLUGINS}
              quality={HQ}
            />
            <div style={{ marginTop: 6 }}>
              <Write
                font={FONTS.caveat}
                text="the city hums at dusk"
                time={Math.max(0, Math.min(1, subT / VIDEO.subSeconds))}
                unit="progress"
                size={52}
                color="rgba(255, 244, 230, 0.9)"
                quality={HQ}
              />
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              right: 18,
              bottom: 14,
              fontFamily: MONO,
              fontSize: 16,
              color: 'rgba(255,255,255,0.8)',
              background: 'rgba(0,0,0,0.35)',
              padding: '4px 10px',
              borderRadius: 6,
            }}
          >
            {`00:0${Math.floor(T)}:${String(Math.floor((T % 1) * 30)).padStart(2, '0')}`}
          </div>
        </div>

        {/* Side: the heading, the code, the render button */}
        <div style={{ position: 'absolute', left: SIDE.x, top: SIDE.y, width: SIDE.w }}>
          <div
            style={{ fontFamily: SERIF, fontSize: 92, lineHeight: 0.95, color: C.cream, letterSpacing: -1, opacity: ramp(frame, 6, 26) }}
          >
            Made for <span style={{ fontStyle: 'italic', color: C.sealBright }}>video.</span>
          </div>
          <div style={{ height: 34 }} />
          <div style={{ opacity: ramp(frame, 12, 30), transform: `translateY(${(1 - ramp(frame, 12, 30)) * 16}px)` }}>
            <Code live={Math.max(0, T)} hot={frame >= GRAB - 6 && frame < DROP + 6 ? 1 : 0.35} />
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: RENDER.x,
            top: RENDER.y,
            width: RENDER.w,
            height: RENDER.h,
            borderRadius: 14,
            overflow: 'hidden',
            background: '#221f1c',
            border: `1px solid ${C.nightRule}`,
            opacity: ramp(frame, 18, 34),
          }}
        >
          <div
            style={{ position: 'absolute', inset: 0, width: `${render * 100}%`, background: 'linear-gradient(90deg, #b8401f, #ff6a4d)' }}
          />
          <div
            style={{
              position: 'relative',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 24px',
              fontFamily: SANS,
              fontSize: 22,
              fontWeight: 500,
              color: C.cream,
            }}
          >
            <span>{done ? '✓  kyoto.mp4' : render > 0 ? 'Rendering…' : '▶  Render video'}</span>
            <span style={{ fontFamily: MONO, fontSize: 18, opacity: 0.85 }}>
              {render > 0 ? `${Math.round(render * 180)} / 180 frames` : '1920×1080 · 30 fps'}
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: TL.y,
            height: TL.h,
            background: '#161514',
            borderTop: `1px solid ${C.nightRule}`,
          }}
        >
          <div
            style={{ position: 'absolute', left: TL.x0, right: 1920 - TL.x1, top: 0, height: 36, borderBottom: `1px solid ${C.nightRule}` }}
          >
            {Array.from({ length: EDIT * 4 + 1 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(i / (EDIT * 4)) * 100}%`,
                  bottom: 0,
                  width: 1,
                  height: i % 4 === 0 ? 14 : 7,
                  background: 'rgba(241,233,218,0.35)',
                }}
              >
                {i % 4 === 0 && (
                  <div
                    style={{ position: 'absolute', left: 6, bottom: 14, fontFamily: MONO, fontSize: 13, color: C.nightMuted }}
                  >{`0:0${i / 4}`}</div>
                )}
              </div>
            ))}
          </div>
          {[
            { name: 'Footage', color: '#4a3a66', from: 0, to: EDIT, label: 'dusk.mov' },
            { name: 'Title', color: '#7b61ff', from: TITLE_AT, to: 4.4, label: 'TegakiRenderer · Kyoto, day one' },
            { name: 'Subtitle', color: '#e0843a', from: SUB_AT, to: EDIT, label: 'TegakiRenderer · the city hums…' },
            { name: 'Music', color: '#2f8f83', from: 0, to: EDIT, label: '' },
          ].map((track, i) => (
            <div key={track.name} style={{ position: 'absolute', left: 0, right: 0, top: 50 + i * 58, height: 46 }}>
              <div style={{ position: 'absolute', left: 28, top: 13, fontFamily: SANS, fontSize: 16, color: C.nightMuted }}>
                {track.name}
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: tx(track.from),
                  width: tx(track.to) - tx(track.from),
                  top: 0,
                  height: 46,
                  borderRadius: 8,
                  background: track.color,
                  overflow: 'hidden',
                  opacity: ramp(frame, 8 + i * 3, 24 + i * 3),
                }}
              >
                {track.name === 'Footage' && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'repeating-linear-gradient(90deg, #6b3b73 0 70px, #c2506a 70px 140px, #f39a5a 140px 210px)',
                      opacity: 0.5,
                    }}
                  />
                )}
                {track.name === 'Music' &&
                  Array.from({ length: 150 }, (_, j) => (
                    <div
                      key={j}
                      style={{
                        position: 'absolute',
                        left: j * 11.2,
                        width: 5,
                        top: '50%',
                        height: 6 + random(`wave${j}`) * 30 * (0.5 + 0.5 * Math.sin(j / 9)),
                        transform: 'translateY(-50%)',
                        background: 'rgba(200, 255, 240, 0.55)',
                        borderRadius: 3,
                      }}
                    />
                  ))}
                <div
                  style={{ position: 'relative', padding: '12px 14px', fontFamily: MONO, fontSize: 15, color: 'rgba(255,255,255,0.92)' }}
                >
                  {track.label}
                </div>
              </div>
            </div>
          ))}
          {/* Playhead */}
          <div style={{ position: 'absolute', left: tx(T) - 1, top: 0, width: 2, height: TL.h, background: C.sealBright }} />
          <div
            style={{
              position: 'absolute',
              left: tx(T) - 9,
              top: 6,
              width: 18,
              height: 24,
              borderRadius: '5px 5px 9px 9px',
              background: C.sealBright,
              boxShadow: dragging ? '0 0 0 6px rgba(255,106,77,0.25)' : 'none',
            }}
          />
        </div>
        <Cursor x={dragging ? tx(T) : cur.x} y={dragging ? TL.y + 18 : cur.y} down={down} opacity={ramp(frame, 30, 40)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
