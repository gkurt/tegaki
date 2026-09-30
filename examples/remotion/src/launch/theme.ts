import { loadFont as loadGeist } from '@remotion/google-fonts/Geist';
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono';
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { Easing, interpolate } from 'remotion';

// The site's palette (packages/website/src/styles/home.css): ink on paper by
// day, sumi on night by dark, a red seal and gold for accents.
export const C = {
  paper: '#f4eee2',
  paperDeep: '#ebe3d3',
  card: '#fbf8f1',
  ink: '#1c1d2b',
  inkSoft: '#45443f',
  muted: '#6d6a63',
  rule: 'rgba(28, 29, 43, 0.12)',
  night: '#0e0d0c',
  nightDeep: '#080707',
  nightCard: '#1a1916',
  cream: '#f1e9da',
  creamSoft: '#cdc4b4',
  nightMuted: '#958f84',
  nightRule: 'rgba(241, 233, 218, 0.12)',
  seal: '#d33a26',
  sealBright: '#ff6a4d',
  gold: '#e8c27a',
} as const;

export const SERIF = loadInstrumentSerif('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily;
loadInstrumentSerif('italic', { weights: ['400'], subsets: ['latin'] });
export const SANS = loadGeist('normal', { weights: ['400', '500', '600'], subsets: ['latin'] }).fontFamily;
export const MONO = loadGeistMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1), // expo-ish out: fast start, long settle
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  soft: Easing.bezier(0.33, 1, 0.68, 1),
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 → 1 over frames [a, b], eased. */
export function ramp(frame: number, a: number, b: number, easing: (t: number) => number = EASE.out): number {
  return interpolate(frame, [a, b], [0, 1], { ...clamp, easing });
}

/** `from` → `to` over frames [a, b], eased. */
export function tween(frame: number, a: number, b: number, from: number, to: number, easing: (t: number) => number = EASE.out): number {
  return from + (to - from) * ramp(frame, a, b, easing);
}

/** Piecewise interpolation, clamped, one easing for every leg. */
export function keys(frame: number, frames: number[], values: number[], easing: (t: number) => number = EASE.inOut): number {
  return interpolate(frame, frames, values, { ...clamp, easing });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
