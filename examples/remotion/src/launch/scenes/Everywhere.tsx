import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { taperPlugin } from 'tegaki/core';
import { FONTS } from '../fonts.ts';
import { foil } from '../plugins/foil.ts';
import { strokeNumbers } from '../plugins/strokeNumbers.ts';
import { C, EASE, MONO, ramp, SANS, SERIF } from '../theme.ts';
import { Write } from '../Write.tsx';

export const EVERYWHERE_FRAMES = 106;

const FRAMEWORKS = ['React', 'Vue', 'Svelte', 'Solid', 'Astro', 'Next.js', 'Nuxt', 'Web Components', 'Remotion', 'Vanilla JS'];
const LEARN = [strokeNumbers()];
const CARD = [foil({ speed: 0.5 })];
const CHAT = [taperPlugin({ startLength: 0.1, endLength: 0.15 })];
const HQ = { pixelRatio: 1.5 };

const Tile: React.FC<{ at: number; label: string; children: ReactNode; style?: CSSProperties }> = ({ at, label, children, style }) => {
  const frame = useCurrentFrame();
  const p = ramp(frame, at, at + 20, EASE.out);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        opacity: p,
        transform: `translateY(${(1 - p) * 70}px)`,
      }}
    >
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 2px 4px rgba(60,40,10,0.06), 0 30px 60px -24px rgba(60,40,10,0.4)',
          ...style,
        }}
      >
        {children}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: 3, textTransform: 'uppercase', color: C.muted }}>{label}</div>
    </div>
  );
};

/** ...and everywhere else: a website, an AI chat, a stroke-order lesson, a card. */
export const Everywhere: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 30%, ${C.paper} 0%, ${C.paperDeep} 100%)`,
        transform: `translateY(${(1 - ramp(frame, 0, 12, EASE.out)) * 100}%)`,
        boxShadow: '0 -30px 80px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 84,
          fontFamily: SERIF,
          fontSize: 76,
          color: C.ink,
          letterSpacing: -0.5,
          opacity: ramp(frame, 2, 18),
          transform: `translateX(${(1 - ramp(frame, 2, 22)) * -30}px)`,
        }}
      >
        …and <span style={{ fontStyle: 'italic', color: C.seal }}>everywhere</span> else.
      </div>
      <AbsoluteFill
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, top: 40, transform: 'scale(1.07)' }}
      >
        <Tile at={4} label="Websites" style={{ width: 560, height: 380, borderRadius: 14, background: '#fff' }}>
          <div style={{ height: 38, background: '#f1ece2', display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />
            ))}
            <div
              style={{
                marginLeft: 14,
                flex: 1,
                height: 22,
                borderRadius: 6,
                background: '#fff',
                fontFamily: SANS,
                fontSize: 12,
                color: C.muted,
                padding: '3px 10px',
              }}
            >
              yoursite.com
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '18px 28px' }}>
            <div style={{ width: 70, height: 12, borderRadius: 4, background: C.ink }} />
            <div style={{ display: 'flex', gap: 14 }}>
              {[40, 52, 36].map((w) => (
                <div key={w} style={{ width: w, height: 10, borderRadius: 4, background: 'rgba(28,29,43,0.15)' }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 34 }}>
            <Write font={FONTS.parisienne} text="Welcome home" from={14} frames={48} size={86} color={C.ink} quality={HQ} />
            <div style={{ width: 280, height: 10, borderRadius: 4, background: 'rgba(28,29,43,0.1)', marginTop: 22 }} />
            <div style={{ width: 200, height: 10, borderRadius: 4, background: 'rgba(28,29,43,0.1)', marginTop: 10 }} />
            <div
              style={{
                marginTop: 24,
                padding: '10px 22px',
                borderRadius: 99,
                background: C.seal,
                color: '#fff',
                fontFamily: SANS,
                fontSize: 14,
              }}
            >
              Get started
            </div>
          </div>
        </Tile>
        <Tile at={9} label="AI chat" style={{ width: 300, height: 560, borderRadius: 44, background: '#111', padding: 10 }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 36,
              background: '#faf7f1',
              padding: '54px 16px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div
              style={{
                alignSelf: 'flex-end',
                background: C.ink,
                color: '#fff',
                fontFamily: SANS,
                fontSize: 15,
                padding: '10px 14px',
                borderRadius: '18px 18px 4px 18px',
              }}
            >
              write me a haiku
            </div>
            <div
              style={{
                alignSelf: 'flex-start',
                background: '#fff',
                border: `1px solid ${C.rule}`,
                padding: '10px 14px 14px',
                borderRadius: '18px 18px 18px 4px',
              }}
            >
              <Write
                font={FONTS.caveat}
                text={'ink finds the paper\neach stroke a heartbeat\nwords learn to breathe'}
                from={20}
                frames={58}
                size={24}
                color={C.ink}
                plugins={CHAT}
                quality={HQ}
                style={{ lineHeight: 1.25 }}
              />
            </div>
          </div>
        </Tile>
        <Tile at={14} label="Learning" style={{ width: 360, height: 360, borderRadius: 18, background: '#fffdf8' }}>
          <svg width={360} height={360} style={{ position: 'absolute', inset: 0 }}>
            <rect x={30} y={30} width={300} height={300} fill="none" stroke="rgba(211,58,38,0.6)" strokeWidth={2} />
            <g stroke="rgba(211,58,38,0.35)" strokeDasharray="6 6" strokeWidth={1.4}>
              <line x1={180} y1={30} x2={180} y2={330} />
              <line x1={30} y1={180} x2={330} y2={180} />
              <line x1={30} y1={30} x2={330} y2={330} />
              <line x1={330} y1={30} x2={30} y2={330} />
            </g>
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Write
              font={FONTS.kleeOne}
              text="書"
              from={20}
              frames={80}
              size={250}
              color={C.ink}
              plugins={LEARN}
              quality={HQ}
              style={{ lineHeight: 1 }}
            />
          </div>
        </Tile>
        <Tile
          at={19}
          label="Cards & invites"
          style={{
            width: 420,
            height: 300,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #2a1a2e 0%, #1a1020 100%)',
            border: '1px solid #3a2a3e',
          }}
        >
          <div style={{ position: 'absolute', inset: 14, border: '1.5px solid rgba(232, 194, 122, 0.55)', borderRadius: 4 }} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Write
              font={FONTS.parisienne}
              text={'Happy birthday,\nMia'}
              from={26}
              frames={60}
              size={60}
              color={C.gold}
              plugins={CARD}
              quality={HQ}
              style={{ textAlign: 'center' }}
            />
          </div>
        </Tile>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {FRAMEWORKS.map((f, i) => {
          const p = ramp(frame, 34 + i * 3, 48 + i * 3, EASE.out);
          return (
            <div
              key={f}
              style={{
                fontFamily: MONO,
                fontSize: 17,
                color: C.inkSoft,
                padding: '8px 16px',
                borderRadius: 99,
                border: `1px solid ${C.rule}`,
                background: 'rgba(255,255,255,0.5)',
                opacity: p,
                transform: `translateY(${(1 - p) * 14}px)`,
              }}
            >
              {f}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
