// All font bundles ship pre-generated inside the published `tegaki` package.
// Importing them here is the whole point of the promo: real handwriting data,
// straight off npm, for Latin cursive, Japanese, Korean and Hebrew scripts.
import caveat from 'tegaki/fonts/caveat';
import italianno from 'tegaki/fonts/italianno';
import kleeOne from 'tegaki/fonts/klee-one';
import nanumPenScript from 'tegaki/fonts/nanum-pen-script';
import parisienne from 'tegaki/fonts/parisienne';
import suezOne from 'tegaki/fonts/suez-one';
import tangerine from 'tegaki/fonts/tangerine';

export const fonts = {
  caveat,
  italianno,
  kleeOne,
  nanumPenScript,
  parisienne,
  suezOne,
  tangerine,
} as const;

export type FontKey = keyof typeof fonts;
