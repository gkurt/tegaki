import { AbsoluteFill, Sequence } from 'remotion';
import { Grain, InkWipe } from './components.tsx';
import './fonts.ts';
import { EVERYWHERE_FRAMES, Everywhere } from './scenes/Everywhere.tsx';
import { OUTRO_FRAMES, Outro } from './scenes/Outro.tsx';
import { PLUGINS_FRAMES, Plugins } from './scenes/Plugins.tsx';
import { SCRIPTS_FRAMES, Scripts } from './scenes/Scripts.tsx';
import { STUDIO_FRAMES, Studio } from './scenes/Studio.tsx';
import { TITLE_FRAMES, Title } from './scenes/Title.tsx';
import { VIDEO_FRAMES, Video } from './scenes/Video.tsx';
import { C } from './theme.ts';

export { FPS as LAUNCH_FPS, HEIGHT as LAUNCH_HEIGHT, WIDTH as LAUNCH_WIDTH } from './theme.ts';

// Scenes in order, each with the frames it overlaps the one before by (for the transition into it).
const SCENES = [
  { id: 'title', frames: TITLE_FRAMES, overlap: 0, Scene: Title },
  { id: 'scripts', frames: SCRIPTS_FRAMES, overlap: 4, Scene: Scripts },
  { id: 'studio', frames: STUDIO_FRAMES, overlap: 12, Scene: Studio },
  { id: 'plugins', frames: PLUGINS_FRAMES, overlap: 6, Scene: Plugins },
  { id: 'video', frames: VIDEO_FRAMES, overlap: 10, Scene: Video },
  { id: 'everywhere', frames: EVERYWHERE_FRAMES, overlap: 8, Scene: Everywhere },
  { id: 'outro', frames: OUTRO_FRAMES, overlap: 4, Scene: Outro },
] as const;

const starts: number[] = [];
for (let i = 0, at = 0; i < SCENES.length; i++) {
  at += i === 0 ? 0 : SCENES[i - 1]!.frames - SCENES[i]!.overlap;
  starts.push(at);
}

export const LAUNCH_DURATION = starts[starts.length - 1]! + SCENES[SCENES.length - 1]!.frames;
export const SCENE_STARTS = Object.fromEntries(SCENES.map((s, i) => [s.id, starts[i]!]));

export const Launch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.night }}>
    {SCENES.map(({ id, frames, Scene }, i) => (
      <Sequence key={id} name={id} from={starts[i]} durationInFrames={frames}>
        <Scene />
        {id === 'title' && <InkWipe id="t2s" at={frames - 20} dur={16} color={C.paper} />}
        {id === 'everywhere' && <InkWipe id="e2o" at={frames - 15} dur={13} color={C.night} />}
      </Sequence>
    ))}
    <Grain />
  </AbsoluteFill>
);
