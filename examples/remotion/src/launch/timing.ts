// When things happen, in frames — shared by the scenes and the soundtrack
// script (scripts/soundtrack.ts), so the music and the sound effects land on
// what they go with. Pure: no DOM, no Remotion.

export const FPS = 30;

/** One bar of the music: 67 frames, four beats at 107.46 BPM. The cuts into the plugins, the video and the outro fall on bars. */
export const BAR = 67;
export const BEAT = BAR / 4;

/** How long the title runs: short, so the video gets going before a glance moves on. */
const TITLE_FRAMES = 104;

/**
 * The frame the music's bar 0 starts at. The title is shorter than the intro's
 * four bars, so the music comes in partway through its first bar and the drop
 * still lands on the cut into the plugins.
 */
export const ORIGIN = TITLE_FRAMES - 4 + 122 - 4 * BAR;
/** The frame bar `n` (and `beat`) of the music starts at. */
export const bar = (n: number, beat = 0) => ORIGIN + n * BAR + beat * BEAT;

/** Where each scene starts and how long it runs, in the order they play. Neighbours overlap for the transitions. */
export const SCENE = {
  title: { at: 0, frames: TITLE_FRAMES },
  scripts: { at: TITLE_FRAMES - 4, frames: bar(4) - (TITLE_FRAMES - 4) },
  plugins: { at: bar(4), frames: 270 },
  video: { at: bar(8), frames: 186 },
  studio: { at: bar(8) + 182, frames: 250 },
  everywhere: { at: bar(16) - 102, frames: 106 },
  outro: { at: bar(16), frames: 122 },
} as const;

export type SceneId = keyof typeof SCENE;

export const DURATION = SCENE.outro.at + SCENE.outro.frames;

/** The poster: the outro's finished card, `fromEnd` frames before it ends, shown over the first `frames` frames (the title starts blank). */
export const POSTER = { frames: 1, fromEnd: 3 };

/** The wipes: brush strokes over the frame, from `at` (scene frames) for `dur`. */
export const WIPES = {
  titleOut: { at: SCENE.title.frames - 18, dur: 14 },
  videoOut: { at: SCENE.studio.at - SCENE.video.at - 16, dur: 16 },
  everywhereOut: { at: SCENE.everywhere.frames - 15, dur: 13 },
};

// --- Title --------------------------------------------------------------

export const TITLE = {
  /** 手書き, brushed. */
  kanji: { from: 0, frames: 30 },
  name: { from: 12, frames: 50 },
  version: { from: 54, frames: 14 },
  /** The circle round the version, after it's written: seconds. */
  circle: { delay: 0.05, duration: 0.4 },
  tagline: 64,
};

// --- Scripts ------------------------------------------------------------

/** A card's pen starts `6 + distance * 11` frames in, rippling out from the card the camera starts on. */
export const SCRIPTS = {
  rippleAt: 6,
  rippleStep: 11,
  writeFrames: 46,
  tagline: 74,
  /** Back into the card it started on, into black: the drop comes out of it. */
  whip: [90, SCENE.scripts.frames - 4] as const,
};

// --- Studio -------------------------------------------------------------

export const STUDIO = {
  skeleton: 40,
  strokes: 62,
  final: 86,
  text: 124,
  picker: 148,
  parisienne: 170,
  pluginsTab: 188,
  rainbow: 200,
  glow: 214,
  boil: 228,
  /** Out through the canvas, into black. */
  whip: [230, 246] as const,
  writeFrames: 46,
};

// --- Plugins ------------------------------------------------------------

export const PLUGINS = {
  /** Frames each split starts at. */
  splits: [52, 102, 150],
  splitFrames: 16,
  /** When each panel's pen starts: as it appears. */
  appear: [2, 52, 102, 102, 150, 150, 150, 150],
  /** And all together, for the finale. */
  unison: 206,
  writeFrames: 46,
  unisonFrames: 44,
};

// --- Video --------------------------------------------------------------

export const VIDEO = {
  /** Seconds of the edit being made. */
  edit: 6,
  titleAt: 0.35,
  titleSeconds: 2.3,
  subAt: 2.7,
  subSeconds: 1.5,
  play: 18,
  grab: 76,
  back: 94,
  drop: 118,
  render: 134,
  rendered: 160,
};

const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number) => {
  // Solve for the curve's t at x by bisection; plenty for a playhead.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    const bx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (bx < x) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
};
const inOut = bezier(0.65, 0, 0.35, 1);

/** The playhead, in edit seconds, at a frame of the video scene: it plays, is dragged back, then forward, and plays on. */
export function playhead(f: number): number {
  const v = VIDEO;
  const rate = 1.1 / FPS;
  if (f < v.play) return 0;
  const atGrab = (v.grab - v.play) * rate;
  if (f < v.grab) return (f - v.play) * rate;
  if (f < v.back) return atGrab + (0.75 - atGrab) * inOut((f - v.grab) / (v.back - v.grab));
  if (f < v.drop) return 0.75 + (4.1 - 0.75) * inOut((f - v.back) / (v.drop - v.back));
  return Math.min(v.edit, 4.1 + (f - v.drop) * rate);
}

// --- Everywhere ---------------------------------------------------------

export const EVERYWHERE = {
  tiles: [4, 9, 14, 19],
  web: { from: 14, frames: 48 },
  chat: { from: 20, frames: 58 },
  learn: { from: 20, frames: 80 },
  card: { from: 26, frames: 60 },
  chips: 34,
  chipStep: 3,
};

// --- Outro --------------------------------------------------------------

export const OUTRO = {
  kanji: { from: 0, frames: 26 },
  name: { from: 8, frames: 40 },
  version: { from: 46, frames: 12 },
  circle: { delay: 0.05, duration: 0.4 },
  install: 56,
  typing: { at: 60, cps: 24, text: 'npm i tegaki' },
  url: 74,
  sign: { from: 72, frames: 30 },
};
