import { continueRender, delayRender } from 'remotion';
import { TegakiEngine } from 'tegaki/core';
import amiri from 'tegaki/fonts/amiri';
import atma from 'tegaki/fonts/atma';
import caveat from 'tegaki/fonts/caveat';
import hersheyScript from 'tegaki/fonts/hershey-script';
import italianno from 'tegaki/fonts/italianno';
import kleeOne from 'tegaki/fonts/klee-one';
import lxgwWenkai from 'tegaki/fonts/lxgw-wenkai';
import nanumPenScript from 'tegaki/fonts/nanum-pen-script';
import parisienne from 'tegaki/fonts/parisienne';
import suezOne from 'tegaki/fonts/suez-one';
import tangerine from 'tegaki/fonts/tangerine';
import tillana from 'tegaki/fonts/tillana';
import harfbuzzShaper from 'tegaki/shaper-harfbuzz';

// Arabic joins, Devanagari and Bengali conjuncts need shaping.
TegakiEngine.registerShaper(harfbuzzShaper);

export const FONTS = {
  amiri,
  atma,
  caveat,
  hersheyScript,
  italianno,
  kleeOne,
  lxgwWenkai,
  nanumPenScript,
  parisienne,
  suezOne,
  tangerine,
  tillana,
};

export type Bundle = (typeof FONTS)[keyof typeof FONTS];

/** A bundle's font as a CSS font-family (its name has a token starting with a digit, so it's quoted). */
export const family = (bundle: Bundle) => `"${bundle.family}"`;

// Every frame of the video is rendered in a fresh tab at some point, so hold
// the render until each bundle's font faces and shaper are in: a renderer
// handed a preloaded bundle draws it complete on its first frame.
const handle = delayRender('Preloading tegaki bundles', { timeoutInMilliseconds: 120_000 });
Promise.all(Object.values(FONTS).map((b) => TegakiEngine.preload(b)))
  .then(() => document.fonts.ready)
  .then(() => continueRender(handle));
