import type { CSSProperties } from 'react';
import { AbsoluteFill, Easing, interpolate, Series, useCurrentFrame } from 'remotion';
import { TegakiRenderer } from 'tegaki';
import caveat from 'tegaki/fonts/caveat';
import italianno from 'tegaki/fonts/italianno';
import parisienne from 'tegaki/fonts/parisienne';
import tangerine from 'tegaki/fonts/tangerine';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const BG = '#0f0f17';
const INK = '#f4ecdc';
const MUTED = '#7d7665';
const ACCENT = '#e0a566';

const SANS: CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif',
};

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

// All four bundles share the same shape but with literal `family` strings, so
// we widen here to a structural type that any bundle satisfies.
type FontBundle = typeof caveat | typeof italianno | typeof parisienne | typeof tangerine;

interface SceneBoxProps {
  duration: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  children: React.ReactNode;
  background?: string;
}

/** Wraps a scene with cross-fade in/out and a subtle vertical drift. */
const SceneBox: React.FC<SceneBoxProps> = ({ duration, fadeInFrames = 10, fadeOutFrames = 14, children, background = BG }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, fadeInFrames, duration - fadeOutFrames, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const drift = interpolate(frame, [0, duration], [12, -12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(frame, [0, duration], [0.985, 1.015], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: background, opacity }}>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 36,
          color: INK,
          transform: `translateY(${drift}px) scale(${scale})`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

interface WritingSceneProps {
  duration: number;
  font: FontBundle;
  text: string;
  fontSize?: number;
  ink?: string;
  effects?: Record<string, unknown>;
  /** Fraction of scene length used to draw the strokes (rest is hold). */
  writeFraction?: number;
  eyebrow?: string;
  caption?: string;
}

/** A scene that writes a phrase with the given font, then holds it. */
const WritingScene: React.FC<WritingSceneProps> = ({
  duration,
  font,
  text,
  fontSize = 200,
  ink = INK,
  effects,
  writeFraction = 0.65,
  eyebrow,
  caption,
}) => {
  const frame = useCurrentFrame();
  const writeEnd = Math.max(8, Math.floor(duration * writeFraction));
  // Linear progress preserves the engine's per-stroke pacing — no extra easing.
  const progress = interpolate(frame, [0, writeEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const captionOpacity = interpolate(frame, [writeEnd - 4, writeEnd + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <SceneBox duration={duration}>
      {eyebrow && (
        <div
          style={{
            ...SANS,
            color: MUTED,
            fontSize: 22,
            letterSpacing: 8,
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          {eyebrow}
        </div>
      )}
      <TegakiRenderer
        font={font}
        text={text}
        style={{ fontSize, color: ink, lineHeight: 1.15, textAlign: 'center', maxWidth: 1500 }}
        time={{ mode: 'controlled', value: progress, unit: 'progress' }}
        effects={effects as never}
      />
      {caption && (
        <div
          style={{
            ...SANS,
            color: MUTED,
            fontSize: 26,
            letterSpacing: 1,
            opacity: captionOpacity,
          }}
        >
          {caption}
        </div>
      )}
    </SceneBox>
  );
};

// ---------------------------------------------------------------------------
// Specialty scenes
// ---------------------------------------------------------------------------

/** Opening: brand mark writes itself, then a kanji subtitle whispers in. */
const Hero: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const writeEnd = Math.floor(duration * 0.5);
  const progress = interpolate(frame, [0, writeEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subtitleOpacity = interpolate(frame, [writeEnd - 6, writeEnd + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subtitleY = interpolate(frame, [writeEnd - 6, writeEnd + 24], [12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <SceneBox duration={duration}>
      <TegakiRenderer
        font={caveat}
        text="tegaki"
        style={{ fontSize: 320, color: INK }}
        time={{ mode: 'controlled', value: progress, unit: 'progress' }}
        effects={{
          glow: { enabled: true, radius: '0.12em', color: 'rgba(224, 165, 102, 0.35)' },
        }}
      />
      <div
        style={{
          ...SANS,
          color: MUTED,
          fontSize: 28,
          letterSpacing: 16,
          textTransform: 'uppercase',
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
        }}
      >
        手書き · handwriting
      </div>
    </SceneBox>
  );
};

/** Effects showcase: the same word, three vibes. */
const EffectsShowcase: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const writeEnd = Math.floor(duration * 0.55);
  const progress = interpolate(frame, [0, writeEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });

  const time = { mode: 'controlled' as const, value: progress, unit: 'progress' as const };
  const baseStyle: CSSProperties = { fontSize: 140, lineHeight: 1.1, textAlign: 'center' };

  return (
    <SceneBox duration={duration}>
      <div
        style={{
          ...SANS,
          color: MUTED,
          fontSize: 22,
          letterSpacing: 8,
          textTransform: 'uppercase',
        }}
      >
        Effects, built in
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'center' }}>
        <TegakiRenderer
          font={caveat}
          text="vibrant"
          style={{ ...baseStyle, color: INK }}
          time={time}
          effects={{
            strokeGradient: { enabled: true, colors: 'rainbow', saturation: 90, lightness: 70 },
          }}
        />
        <TegakiRenderer
          font={italianno}
          text="luminous"
          style={{ ...baseStyle, fontSize: 180, color: '#fff5e1' }}
          time={time}
          effects={{
            glow: { enabled: true, radius: '0.18em', color: 'rgba(255, 196, 120, 0.7)' },
            taper: { enabled: true, startLength: 0.05, endLength: 0.05 },
          }}
        />
        <TegakiRenderer
          font={parisienne}
          text="alive"
          style={{ ...baseStyle, color: INK }}
          time={time}
          effects={{
            wobble: { enabled: true, amplitude: 0.6, frequency: 8, mode: 'sine' },
            pressureWidth: { enabled: true, strength: 0.6 },
          }}
        />
      </div>
    </SceneBox>
  );
};

/** Closing: brand + install line. */
const Outro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const writeEnd = Math.floor(duration * 0.45);
  const progress = interpolate(frame, [0, writeEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lineOpacity = interpolate(frame, [writeEnd, writeEnd + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const urlOpacity = interpolate(frame, [writeEnd + 14, writeEnd + 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lift = interpolate(frame, [writeEnd, writeEnd + 28], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <SceneBox duration={duration} fadeOutFrames={28}>
      <TegakiRenderer
        font={caveat}
        text="start writing"
        style={{ fontSize: 220, color: INK, textAlign: 'center' }}
        time={{ mode: 'controlled', value: progress, unit: 'progress' }}
        effects={{
          glow: { enabled: true, radius: '0.12em', color: 'rgba(224, 165, 102, 0.35)' },
        }}
      />
      <div
        style={{
          opacity: lineOpacity,
          transform: `translateY(${lift}px)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            ...SANS,
            color: ACCENT,
            fontSize: 30,
            letterSpacing: 2,
            backgroundColor: 'rgba(224, 165, 102, 0.08)',
            border: '1px solid rgba(224, 165, 102, 0.25)',
            padding: '14px 28px',
            borderRadius: 999,
            fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
          }}
        >
          npm install tegaki
        </div>
        <div
          style={{
            ...SANS,
            color: MUTED,
            fontSize: 22,
            letterSpacing: 6,
            opacity: urlOpacity,
          }}
        >
          gkurt.com/tegaki
        </div>
      </div>
    </SceneBox>
  );
};

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const OVERLAP = 14;

// Scene durations (frames at 30fps). Order matters.
const SCENES = [
  { id: 'hero', duration: 110 }, // ~3.7s — brand intro
  { id: 'tagline', duration: 110 }, // ~3.7s — value prop
  { id: 'caveat', duration: 130 }, // ~4.3s
  { id: 'italianno', duration: 130 }, // ~4.3s
  { id: 'parisienne', duration: 130 }, // ~4.3s
  { id: 'tangerine', duration: 130 }, // ~4.3s
  { id: 'effects', duration: 170 }, // ~5.7s
  { id: 'outro', duration: 165 }, // ~5.5s
] as const;

export const PROMO_FPS = 30;
export const PROMO_WIDTH = 1920;
export const PROMO_HEIGHT = 1080;
export const PROMO_DURATION = SCENES.reduce((sum, s) => sum + s.duration, 0) - OVERLAP * (SCENES.length - 1);

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Series>
        <Series.Sequence durationInFrames={SCENES[0].duration}>
          <Hero duration={SCENES[0].duration} />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[1].duration}>
          <WritingScene
            duration={SCENES[1].duration}
            font={caveat}
            text="Handwriting, alive."
            fontSize={170}
            eyebrow="for the modern web"
          />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[2].duration}>
          <WritingScene duration={SCENES[2].duration} font={caveat} text="in any style" fontSize={220} eyebrow="Caveat" />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[3].duration}>
          <WritingScene duration={SCENES[3].duration} font={italianno} text="with elegance" fontSize={280} eyebrow="Italianno" />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[4].duration}>
          <WritingScene duration={SCENES[4].duration} font={parisienne} text="with playful charm" fontSize={200} eyebrow="Parisienne" />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[5].duration}>
          <WritingScene duration={SCENES[5].duration} font={tangerine} text="or timeless grace" fontSize={260} eyebrow="Tangerine" />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[6].duration}>
          <EffectsShowcase duration={SCENES[6].duration} />
        </Series.Sequence>

        <Series.Sequence offset={-OVERLAP} durationInFrames={SCENES[7].duration}>
          <Outro duration={SCENES[7].duration} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
