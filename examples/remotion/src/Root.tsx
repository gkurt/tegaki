import { Composition, useCurrentFrame, useVideoConfig } from 'remotion';
import { TegakiRenderer } from 'tegaki';
import caveat from 'tegaki/fonts/caveat';
import { LAUNCH_DURATION, LAUNCH_FPS, LAUNCH_HEIGHT, LAUNCH_WIDTH, Launch } from './launch/Launch.tsx';
import { PROMO_DURATION, PROMO_FPS, PROMO_HEIGHT, PROMO_WIDTH, Promo } from './Promo';
import { SCRIPTS_PROMO_DURATION, SCRIPTS_PROMO_FPS, SCRIPTS_PROMO_HEIGHT, SCRIPTS_PROMO_WIDTH, ScriptsPromo } from './ScriptsPromo';

const Handwriting = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / durationInFrames;
  return (
    <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <TegakiRenderer
        font={caveat}
        text="What a wonderful world"
        style={{ fontSize: 120 }}
        time={{ mode: 'controlled', value: progress, unit: 'progress' }}
      />
    </div>
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Handwriting" component={Handwriting} durationInFrames={180} fps={60} width={1920} height={1080} />
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={PROMO_DURATION}
        fps={PROMO_FPS}
        width={PROMO_WIDTH}
        height={PROMO_HEIGHT}
      />
      <Composition
        id="Launch"
        component={Launch}
        durationInFrames={LAUNCH_DURATION}
        fps={LAUNCH_FPS}
        width={LAUNCH_WIDTH}
        height={LAUNCH_HEIGHT}
      />
      <Composition
        id="ScriptsPromo"
        component={ScriptsPromo}
        durationInFrames={SCRIPTS_PROMO_DURATION}
        fps={SCRIPTS_PROMO_FPS}
        width={SCRIPTS_PROMO_WIDTH}
        height={SCRIPTS_PROMO_HEIGHT}
      />
    </>
  );
};
