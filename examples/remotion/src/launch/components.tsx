import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { C, EASE, MONO, ramp, SANS } from './theme.ts';

/** Film grain and a vignette over everything, so flat fills read as a picture. */
export const Grain: React.FC<{ opacity?: number; vignette?: number }> = ({ opacity = 0.07, vignette = 0.45 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 12;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity, mixBlendMode: 'overlay' }}>
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.2" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,${vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};

/** Text that rises into place out of a blur. */
export const Rise: React.FC<{ at: number; dur?: number; dy?: number; children: ReactNode; style?: CSSProperties }> = ({
  at,
  dur = 22,
  dy = 18,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const p = ramp(frame, at, at + dur, EASE.out);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * dy}px)`, filter: `blur(${(1 - p) * 8}px)`, ...style }}>{children}</div>
  );
};

/** Characters that type in, one per frame or so, with a caret. */
export const Typed: React.FC<{ text: string; at: number; cps?: number; caret?: boolean; style?: CSSProperties }> = ({
  text,
  at,
  cps = 28,
  caret = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor(((frame - at) / 30) * cps)));
  const blink = Math.floor(frame / 15) % 2 === 0;
  return (
    <span style={{ fontFamily: MONO, whiteSpace: 'pre', ...style }}>
      {text.slice(0, n)}
      {caret && (
        <span style={{ opacity: n < text.length || blink ? 1 : 0, borderLeft: '0.08em solid currentColor', marginLeft: '0.04em' }} />
      )}
    </span>
  );
};

/** A small caps label. */
export const Label: React.FC<{ children: ReactNode; color?: string; style?: CSSProperties }> = ({ children, color = C.muted, style }) => (
  <div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: 3, textTransform: 'uppercase', color, ...style }}>{children}</div>
);

/** A pointer: the macOS-ish arrow, pressed by `down` (0–1). */
export const Cursor: React.FC<{ x: number; y: number; down?: number; opacity?: number }> = ({ x, y, down = 0, opacity = 1 }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - down * 0.14})`,
      transformOrigin: '4px 4px',
      filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.35))',
      zIndex: 100,
    }}
  >
    {down > 0 && (
      <div
        style={{
          position: 'absolute',
          left: -22 + 4,
          top: -22 + 4,
          width: 44,
          height: 44,
          borderRadius: 999,
          background: `rgba(211, 58, 38, ${0.25 * down})`,
          transform: `scale(${0.6 + down * 0.6})`,
        }}
      />
    )}
    <svg width="30" height="34" viewBox="0 0 30 34" role="img" aria-label="cursor">
      <path d="M3 2 L3 26 L9.5 20 L14 31 L18.5 29 L14 18.5 L23 18.5 Z" fill="#111" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  </div>
);

/**
 * A cursor path: keyframes of (frame, x, y, press). Between keys it glides
 * on an eased curve with a slight arc, the way a hand moves a mouse.
 */
export function cursorAt(frame: number, keys: readonly [f: number, x: number, y: number, click?: boolean][]) {
  let x = keys[0]![1];
  let y = keys[0]![2];
  for (let i = 1; i < keys.length; i++) {
    const [f0, x0, y0] = keys[i - 1]!;
    const [f1, x1, y1] = keys[i]!;
    if (frame <= f0) break;
    const t = EASE.inOut(Math.min(1, (frame - f0) / Math.max(1, f1 - f0)));
    const arc = Math.sin(t * Math.PI) * Math.min(60, Math.hypot(x1 - x0, y1 - y0) * 0.12);
    x = x0 + (x1 - x0) * t;
    y = y0 + (y1 - y0) * t - arc;
  }
  let down = 0;
  for (const [f, , , click] of keys) {
    if (!click) continue;
    const d = frame - f;
    if (d >= -3 && d <= 6) down = Math.max(down, d < 0 ? (d + 3) / 3 : 1 - d / 6);
  }
  return { x, y, down };
}

/**
 * A transition: two broad brush strokes of `color` sweep over the frame
 * from `at`, covering it by `at + dur`. Put the next scene over it from then.
 */
export const InkWipe: React.FC<{ at: number; dur?: number; color: string; id: string }> = ({ at, dur = 16, color, id }) => {
  const frame = useCurrentFrame();
  const a = ramp(frame, at, at + dur * 0.7, EASE.in);
  const b = ramp(frame, at + dur * 0.3, at + dur, EASE.in);
  if (frame < at) return null;
  // Path lengths are normalized with pathLength=1.
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
        <filter id={`rough-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="3" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="90" />
        </filter>
        <g filter={`url(#rough-${id})`} fill="none" stroke={color} strokeLinecap="round">
          <path
            d="M -300 380 C 400 120, 1100 520, 2250 180"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - a}
            strokeWidth={900}
          />
          <path
            d="M -300 940 C 500 1100, 1300 640, 2250 900"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - b}
            strokeWidth={900}
          />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

/** Deterministic jitter for a key, -1…1. */
export const jitter = (key: string) => random(key) * 2 - 1;

export const sans = (size: number, weight = 400, color: string = C.ink): CSSProperties => ({
  fontFamily: SANS,
  fontSize: size,
  fontWeight: weight,
  color,
});
