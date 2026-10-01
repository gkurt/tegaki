import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { annotatePlugin, taperPlugin } from 'tegaki/core';
import { Rise } from '../components.tsx';
import { FONTS } from '../fonts.ts';
import { brush } from '../plugins/brush.ts';
import { comet } from '../plugins/comet.ts';
import { C, EASE, SERIF, tween } from '../theme.ts';
import { SCENE, TITLE } from '../timing.ts';
import { Write } from '../Write.tsx';

const HERO = [taperPlugin({ startLength: 0.04, endLength: 0.08 }), comet()];
const KANJI = [brush({ size: 0.068 })];
const VERSION = [annotatePlugin({ mark: 'circle', color: C.gold, width: 0.03, padding: 0.2, ...TITLE.circle, roughness: 0.6 })];
const HQ = { pixelRatio: 1.5 };

const TITLE_FRAMES = SCENE.title.frames;

/** 手書き brushed, the name written by a comet, the version circled — quickly. */
export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = tween(frame, 0, TITLE_FRAMES, 1.0, 1.06, EASE.soft);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 48%, #1d1814 0%, ${C.night} 55%, ${C.nightDeep} 100%)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${zoom})` }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, marginTop: -40 }}>
          <Write font={FONTS.kleeOne} text="手書き" {...TITLE.kanji} size={150} color={C.cream} plugins={KANJI} quality={HQ} />
          <div style={{ position: 'relative', marginTop: -30 }}>
            <Write font={FONTS.parisienne} text="tegaki" {...TITLE.name} size={400} color={C.cream} plugins={HERO} quality={HQ} />
            <div style={{ position: 'absolute', right: -230, top: 70 }}>
              <Write font={FONTS.parisienne} text="1.0" {...TITLE.version} size={140} color={C.gold} plugins={VERSION} />
            </div>
          </div>
          <Rise at={TITLE.tagline} style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 50, color: C.creamSoft, marginTop: 44 }}>
            Handwriting that writes itself.
          </Rise>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
