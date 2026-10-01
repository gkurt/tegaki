import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { annotatePlugin, taperPlugin } from 'tegaki/core';
import { Rise, Typed } from '../components.tsx';
import { FONTS } from '../fonts.ts';
import { brush } from '../plugins/brush.ts';
import { comet } from '../plugins/comet.ts';
import { C, EASE, MONO, ramp, tween } from '../theme.ts';
import { OUTRO, SCENE } from '../timing.ts';
import { Write } from '../Write.tsx';

const OUTRO_FRAMES = SCENE.outro.frames;

const HERO = [taperPlugin({ startLength: 0.04, endLength: 0.08 }), comet({ sparks: 18 })];
const VERSION = [annotatePlugin({ mark: 'circle', color: C.gold, width: 0.03, padding: 0.2, ...OUTRO.circle, roughness: 0.6 })];
const KANJI = [brush({ size: 0.068 })];
const SIGN = [
  annotatePlugin({ mark: 'underline', color: C.sealBright, width: 0.04, padding: 0.12, duration: 0.4, delay: 0.1, roughness: 0.5 }),
];
const HQ = { pixelRatio: 1.5 };

/** The name again, the version circled, how to get it — and a signature. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = tween(frame, 0, OUTRO_FRAMES, 1.04, 1.0, EASE.out);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, #1d1814 0%, ${C.night} 55%, ${C.nightDeep} 100%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${zoom})` }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -60 }}>
          <Write font={FONTS.kleeOne} text="手書き" {...OUTRO.kanji} size={120} color={C.cream} plugins={KANJI} quality={HQ} />
          <div style={{ position: 'relative', marginTop: -30 }}>
            <Write font={FONTS.parisienne} text="tegaki" {...OUTRO.name} size={330} color={C.cream} plugins={HERO} quality={HQ} />
            <div style={{ position: 'absolute', right: -190, top: 58 }}>
              <Write font={FONTS.parisienne} text="1.0" {...OUTRO.version} size={116} color={C.gold} plugins={VERSION} />
            </div>
          </div>
          <Rise at={OUTRO.install} style={{ marginTop: 64 }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 34,
                color: C.cream,
                padding: '16px 30px',
                borderRadius: 14,
                background: 'rgba(241,233,218,0.06)',
                border: `1px solid ${C.nightRule}`,
              }}
            >
              <span style={{ color: C.sealBright }}>$ </span>
              <Typed {...OUTRO.typing} />
            </div>
          </Rise>
          <Rise at={OUTRO.url} style={{ marginTop: 26, fontFamily: MONO, fontSize: 24, letterSpacing: 6, color: C.nightMuted }}>
            tegaki.ink
          </Rise>
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 44,
          display: 'flex',
          justifyContent: 'center',
          opacity: ramp(frame, 70, 74),
        }}
      >
        <Write
          font={FONTS.parisienne}
          text="every handwritten letter here was drawn by tegaki"
          {...OUTRO.sign}
          size={62}
          color={C.cream}
          plugins={SIGN}
        />
      </div>
    </AbsoluteFill>
  );
};
