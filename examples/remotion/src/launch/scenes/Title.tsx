import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { annotatePlugin, glowPlugin, taperPlugin } from 'tegaki/core';
import { Rise } from '../components.tsx';
import { FONTS } from '../fonts.ts';
import { comet } from '../plugins/comet.ts';
import { C, EASE, SERIF, tween } from '../theme.ts';
import { Write } from '../Write.tsx';

const HERO = [
  taperPlugin({ startLength: 0.04, endLength: 0.08 }),
  comet(),
  glowPlugin({ radius: 0.06, color: 'rgba(255, 190, 120, 0.35)' }),
];
const KANJI = [comet({ sparks: 10, hot: 0.2 })];
const VERSION = [
  annotatePlugin({ mark: 'circle', color: C.gold, width: 0.035, padding: 0.18, duration: 0.55, delay: 0.1, roughness: 0.6 }),
];
const HQ = { pixelRatio: 1.5 };

export const TITLE_FRAMES = 150;

/** The name writes itself in fire, the version gets circled. */
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = tween(frame, 0, TITLE_FRAMES, 1.0, 1.06, EASE.soft);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 48%, #1d1814 0%, ${C.night} 55%, ${C.nightDeep} 100%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${zoom})` }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, marginTop: -40 }}>
          <Write font={FONTS.kleeOne} text="手書き" from={2} frames={34} size={64} color={C.creamSoft} plugins={KANJI} />
          <div style={{ position: 'relative', marginTop: -10 }}>
            <Write font={FONTS.caveat} text="tegaki" from={26} frames={70} size={420} color={C.cream} plugins={HERO} quality={HQ} />
            <div style={{ position: 'absolute', right: -250, top: 40 }}>
              <Write font={FONTS.caveat} text="1.0" from={94} speed={1.6} size={150} color={C.gold} plugins={VERSION} />
            </div>
          </div>
          <Rise at={104} style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 50, color: C.creamSoft, marginTop: -6 }}>
            Handwriting that writes itself.
          </Rise>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
