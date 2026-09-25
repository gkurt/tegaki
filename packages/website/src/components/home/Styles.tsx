import { type CSSProperties, useRef } from 'react';
import { TegakiRenderer } from 'tegaki';
import type { TegakiQuality } from 'tegaki/core';
import { type FontName, useFont, useInView } from './shared.ts';

interface Specimen {
  id: string;
  title: string;
  font: FontName;
  text: string;
  size: string;
  effects: Record<string, any>;
  quality?: TegakiQuality;
  /** Seconds to write the text once. */
  duration?: number;
  /** The snippet printed under the card — the part of `effects` that makes the look. */
  code: string;
  dir?: 'rtl';
}

// Each card is a fixed mood (its own paper and ink in both themes), so the
// canvas colors are literal rather than theme-derived.
const SPECIMENS: Specimen[] = [
  {
    id: 'fountain',
    title: 'Fountain pen',
    font: 'Italianno',
    text: 'Yours, always',
    size: 'clamp(64px, 8vw, 116px)',
    effects: { pressureWidth: { strength: 1 }, taper: { startLength: 0.3, endLength: 0.4 } },
    quality: { smoothing: true },
    code: 'pressureWidth + taper',
  },
  {
    id: 'neon',
    title: 'Neon',
    font: 'Parisienne',
    text: 'open late',
    size: 'clamp(48px, 5.4vw, 76px)',
    effects: {
      pressureWidth: false,
      glow: { radius: 6, color: '#ff4fd8' },
      halo: { effect: 'glow', radius: 28, color: '#ff1f8f' },
    },
    code: 'glow × 2',
  },
  {
    id: 'rainbow',
    title: 'Every stroke a color',
    font: 'Caveat',
    text: 'Hello, color!',
    size: 'clamp(46px, 5vw, 70px)',
    effects: { strokeGradient: { colors: 'rainbow', saturation: 78, lightness: 58 }, taper: true },
    code: "strokeGradient: 'rainbow'",
  },
  {
    id: 'chalk',
    title: 'Chalkboard',
    font: 'Caveat',
    text: 'Class starts at 9',
    size: 'clamp(40px, 4.2vw, 60px)',
    effects: {
      pressureWidth: false,
      wobble: { amplitude: 1.2, frequency: 14, mode: 'noise' },
      glow: { radius: 2, color: 'rgba(255,255,255,0.5)' },
    },
    code: "wobble: { mode: 'noise' }",
  },
  {
    id: 'sunset',
    title: 'Golden hour',
    font: 'Tangerine',
    text: 'Golden hour',
    size: 'clamp(72px, 8vw, 120px)',
    effects: { globalGradient: { colors: ['#ffb347', '#ff6f61', '#c2379b', '#5b3fa8'], angle: 0 }, taper: true },
    quality: { smoothing: true },
    code: 'globalGradient',
  },
  {
    id: 'gilded',
    title: 'Inked inside the letter',
    font: 'Suez One',
    text: 'שלום',
    size: 'clamp(64px, 7vw, 104px)',
    effects: { pressureWidth: false, globalGradient: { colors: ['#f7e3a3', '#d4a24c', '#8a5a1c', '#e9c77b'], angle: 70 } },
    quality: { clipText: 2.4 },
    code: 'clipText: 2.4',
    dir: 'rtl',
  },
];

function SpecimenCard({ specimen }: { specimen: Specimen }) {
  const ref = useRef<HTMLElement>(null);
  const near = useInView(ref, { once: true, rootMargin: '300px 0px' });
  const visible = useInView(ref);
  const font = useFont(near ? specimen.font : null);

  return (
    <figure ref={ref} className={`specimen specimen-${specimen.id}`}>
      <div className="specimen-ink" style={{ '--size': specimen.size } as CSSProperties}>
        {font && (
          <TegakiRenderer
            font={font}
            direction={specimen.dir}
            time={{ mode: 'uncontrolled', duration: specimen.duration ?? 3.6, loop: true, loopGap: 2.2, playing: visible }}
            effects={specimen.effects}
            quality={specimen.quality}
          >
            {specimen.text}
          </TegakiRenderer>
        )}
      </div>
      <figcaption>
        <span>{specimen.title}</span>
        <code>{specimen.code}</code>
      </figcaption>
    </figure>
  );
}

export function Styles() {
  return (
    <div className="specimens">
      {SPECIMENS.map((s) => (
        <SpecimenCard key={s.id} specimen={s} />
      ))}
    </div>
  );
}
