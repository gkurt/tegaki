// Local font files for the CLI (`--font-file`): the path for fonts that are not
// on Google Fonts, or not in the variant wanted (LXGW WenKai's mainland-form
// release lives only on GitHub). Node/Bun only.

import { basename, extname } from 'node:path';
import * as opentype from 'opentype.js';
import { charsHash } from '../constants.ts';
import { subsetFont } from './subset.ts';

export interface LocalFont {
  /** Family from the font's name table (the file's basename when it has none). */
  family: string;
  /** The font, subset to the requested characters when `chars` was given. */
  fontBuffer: ArrayBuffer;
  /** Filename for the bundle's copy of the font. */
  fontFileName: string;
}

/** sfnt magic numbers opentype.js can't read: compressed web fonts. */
const WEB_FONT_MAGIC: Record<string, string> = { wOFF: 'WOFF', wOF2: 'WOFF2' };

/**
 * Read a TrueType/OpenType font file. With `chars`, it is subset to exactly
 * those characters (plus the glyphs their layout features reach), the way the
 * Google Fonts `&text=` kits are — a CJK font is tens of megabytes whole.
 * Without, the file is used as-is.
 */
export async function loadLocalFont(path: string, chars?: string): Promise<LocalFont> {
  const file = new Uint8Array(await Bun.file(path).arrayBuffer());
  const magic = new TextDecoder('latin1').decode(file.subarray(0, 4));
  const webFont = WEB_FONT_MAGIC[magic];
  if (webFont) throw new Error(`${path} is a ${webFont} web font; convert it to TTF or OTF first`);

  const bytes = chars === undefined ? file : await subsetFont(file, chars);
  const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const family = opentype.parse(fontBuffer).getEnglishName('fontFamily') || basename(path, extname(path));

  // CFF-flavoured OpenType starts with 'OTTO' and keeps its .otf extension through subsetting.
  const ext = magic === 'OTTO' ? 'otf' : 'ttf';
  const slug = family.toLowerCase().replace(/\s+/g, '-');
  const fontFileName = chars === undefined ? basename(path) : `${slug}-${charsHash(chars)}.${ext}`;
  return { family, fontBuffer, fontFileName };
}
