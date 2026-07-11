// Every font bundle ships pre-generated inside the `tegaki` package. Importing
// them here is the whole point of the demo: real handwriting stroke data — for
// Latin cursive, Japanese, Korean and Hebrew scripts — straight from the library.
import caveat from 'tegaki/fonts/caveat';
import italianno from 'tegaki/fonts/italianno';
import kleeOne from 'tegaki/fonts/klee-one';
import nanumPenScript from 'tegaki/fonts/nanum-pen-script';
import suezOne from 'tegaki/fonts/suez-one';
import tangerine from 'tegaki/fonts/tangerine';

export const fonts = {
  caveat,
  italianno,
  kleeOne,
  nanumPenScript,
  suezOne,
  tangerine,
} as const;

export type FontKey = keyof typeof fonts;
