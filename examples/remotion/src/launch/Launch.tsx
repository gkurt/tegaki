import { AbsoluteFill, Freeze, Html5Audio, Sequence, staticFile } from 'remotion';
import { Grain, InkWipe } from './components.tsx';
import './fonts.ts';
import { Everywhere } from './scenes/Everywhere.tsx';
import { Outro } from './scenes/Outro.tsx';
import { Plugins } from './scenes/Plugins.tsx';
import { Scripts } from './scenes/Scripts.tsx';
import { Studio } from './scenes/Studio.tsx';
import { Title } from './scenes/Title.tsx';
import { Video } from './scenes/Video.tsx';
import { C } from './theme.ts';
import { DURATION, POSTER, SCENE, WIPES } from './timing.ts';

export { FPS as LAUNCH_FPS, HEIGHT as LAUNCH_HEIGHT, WIDTH as LAUNCH_WIDTH } from './theme.ts';

const SCENES = [
  { id: 'title', Scene: Title },
  { id: 'scripts', Scene: Scripts },
  { id: 'plugins', Scene: Plugins },
  { id: 'video', Scene: Video },
  { id: 'studio', Scene: Studio },
  { id: 'everywhere', Scene: Everywhere },
  { id: 'outro', Scene: Outro },
] as const;

export const LAUNCH_DURATION = DURATION;

export const Launch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.night }}>
    {SCENES.map(({ id, Scene }) => (
      <Sequence key={id} name={id} from={SCENE[id].at} durationInFrames={SCENE[id].frames}>
        <Scene />
        {id === 'title' && <InkWipe id="t2s" {...WIPES.titleOut} color={C.paper} />}
        {id === 'video' && <InkWipe id="v2s" {...WIPES.videoOut} color={C.paper} />}
        {id === 'everywhere' && <InkWipe id="e2o" {...WIPES.everywhereOut} color={C.night} />}
      </Sequence>
    ))}
    {/* The first frame is the poster — the finished end card — since that's the thumbnail X and others show. */}
    <Sequence name="poster" durationInFrames={POSTER.frames}>
      <Freeze frame={SCENE.outro.frames - POSTER.fromEnd}>
        <Outro />
      </Freeze>
    </Sequence>
    <Grain />
    {/* Written by scripts/soundtrack.ts, from the same timing (bun run soundtrack). */}
    <Html5Audio src={staticFile('launch-soundtrack.wav')} />
  </AbsoluteFill>
);
