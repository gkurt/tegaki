import {
  type ParsedFontInfo,
  parseFont,
  parseStrokeFont,
  parseStrokeFontFile,
  type StrokeFont,
  type StrokeFontOptions,
} from 'tegaki-generator';
import { getDrawnDatasets } from './drawn-datasets.ts';
import { fetchFontFromCDN } from './font-cdn.ts';

// Stroke fonts in the Studio: single-line fonts made for pen plotters and
// engravers (Evil Mad Scientist's SVG fonts — the Hershey faces and the EMS
// fonts — and Relief SingleLine), fetched at pinned commits from CORS-open
// endpoints, plus the stroke-order datasets drawn by hand. The generator
// turns each into glyph data as it is and synthesizes a font from its strokes
// (see stroke-font/ in tegaki-generator), so they load like any font.

const SVG_FONTS_COMMIT = '8c71f2d9e1a5292047bb88e5595a766241b82cc6';
const RELIEF_COMMIT = '01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d';

const svgFonts = (path: string) =>
  `https://gitlab.com/api/v4/projects/oskay%2Fsvg-fonts/repository/files/${encodeURIComponent(`fonts/${path}.svg`)}/raw?ref=${SVG_FONTS_COMMIT}`;
const relief = (file: string) => `https://cdn.jsdelivr.net/gh/isdat-type/Relief-SingleLine@${RELIEF_COMMIT}/fonts/open_svg/${file}.svg`;

export interface StrokeFontSource {
  /** The family the Studio shows and the URL's `f` carries. */
  name: string;
  group: 'Hershey' | 'EMS' | 'Relief';
  url: string;
}

const hershey = (file: string, name: string): StrokeFontSource => ({ name, group: 'Hershey', url: svgFonts(`Hershey/${file}`) });
const ems = (file: string, name: string): StrokeFontSource => ({ name, group: 'EMS', url: svgFonts(`EMS/${file}`) });

/** The single-line fonts the font picker offers. */
export const STROKE_FONTS: readonly StrokeFontSource[] = [
  hershey('HersheySans1', 'Hershey Sans 1-stroke'),
  hershey('HersheySansMed', 'Hershey Sans Medium'),
  hershey('HersheyScript1', 'Hershey Script 1-stroke'),
  hershey('HersheyScriptMed', 'Hershey Script Medium'),
  hershey('HersheySerifMed', 'Hershey Serif Medium'),
  hershey('HersheySerifMedItalic', 'Hershey Serif Medium Italic'),
  hershey('HersheySerifBold', 'Hershey Serif Bold'),
  hershey('HersheySerifBoldItalic', 'Hershey Serif Bold Italic'),
  hershey('HersheyGothEnglish', 'Hershey Gothic English'),
  hershey('HersheyGothGerman', 'Hershey Gothic German'),
  hershey('HersheyGothItalian', 'Hershey Gothic Italian'),
  hershey('TwinSans', 'Twin Sans'),
  ems('EMSAllure', 'EMS Allure'),
  ems('EMSBird', 'EMS Bird'),
  ems('EMSBirdSwashCaps', 'EMS Bird Swash Caps'),
  ems('EMSBrush', 'EMS Brush'),
  ems('EMSCapitol', 'EMS Capitol'),
  ems('EMSCasualHand', 'EMS Casual Hand'),
  ems('EMSDecorousScript', 'EMS Decorous Script'),
  ems('EMSDelight', 'EMS Delight'),
  ems('EMSDelightSwashCaps', 'EMS Delight Swash Caps'),
  ems('EMSElfin', 'EMS Elfin'),
  ems('EMSFelix', 'EMS Felix'),
  ems('EMSHerculean', 'EMS Herculean'),
  ems('EMSInvite', 'EMS Invite'),
  ems('EMSLeague', 'EMS League'),
  ems('EMSLittlePrincess', 'EMS Little Princess'),
  ems('EMSMistyNight', 'EMS Misty Night'),
  ems('EMSNeato', 'EMS Neato'),
  ems('EMSNixish', 'EMS Nixish'),
  ems('EMSNixishItalic', 'EMS Nixish Italic'),
  ems('EMSOsmotron', 'EMS Osmotron'),
  ems('EMSPancakes', 'EMS Pancakes'),
  ems('EMSPepita', 'EMS Pepita'),
  ems('EMSQwandry', 'EMS Qwandry'),
  ems('EMSReadability', 'EMS Readability'),
  ems('EMSReadabilityItalic', 'EMS Readability Italic'),
  ems('EMSSociety', 'EMS Society'),
  ems('EMSSpaceRocks', 'EMS Space Rocks'),
  ems('EMSSwiss', 'EMS Swiss'),
  ems('EMSTech', 'EMS Tech'),
  { name: 'Relief SingleLine', group: 'Relief', url: relief('ReliefSingleLineSVG-Regular') },
  { name: 'Relief SingleLine Ornament', group: 'Relief', url: relief('ReliefSingleLineOrnament-Regular') },
];

/** The font picker's name for a drawn dataset as a font: `f` then carries it with this prefix. */
export const DRAWN_FONT_PREFIX = 'Drawn: ';

export function isStrokeFontFamily(family: string): boolean {
  return family.startsWith(DRAWN_FONT_PREFIX) || STROKE_FONTS.some((f) => f.name === family);
}

/** Files the font picker's upload reads as stroke fonts rather than font files. */
export function isStrokeFontFile(fileName: string): boolean {
  return /\.(svg|jhf|json)$/i.test(fileName);
}

const fetched = new Map<string, Promise<string>>();

function fetchText(url: string): Promise<string> {
  let text = fetched.get(url);
  if (!text) {
    text = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Couldn't fetch the font (${r.status})`);
      return r.text();
    });
    text.catch(() => fetched.delete(url));
    fetched.set(url, text);
  }
  return text;
}

/** The stroke font a family names: one of STROKE_FONTS, or a drawn dataset. Null for any other family. */
async function strokeFontFor(family: string): Promise<StrokeFont | null> {
  if (family.startsWith(DRAWN_FONT_PREFIX)) {
    const name = family.slice(DRAWN_FONT_PREFIX.length);
    const entry = getDrawnDatasets().entries.find((e) => e.dataset.name === name);
    if (!entry) throw new Error(`No drawn dataset "${name}" in this browser`);
    return { ...parseStrokeFontFile(JSON.stringify(entry.dataset), `${name}.strokes.json`), family };
  }
  const source = STROKE_FONTS.find((f) => f.name === family);
  if (!source) return null;
  return { ...parseStrokeFontFile(await fetchText(source.url), source.url), family };
}

export interface LoadedFontSource {
  info: ParsedFontInfo;
  buffer: ArrayBuffer;
  extraBuffers: ArrayBuffer[] | undefined;
}

/** A stroke font as a loaded font: its synthesized font parsed, drawn as `options` say. */
export async function loadStrokeFont(font: StrokeFont, options: Partial<StrokeFontOptions>): Promise<LoadedFontSource> {
  const { info, buffer } = await parseStrokeFont(font, options);
  return { info, buffer, extraBuffers: undefined };
}

/**
 * The font a family names: a stroke font (STROKE_FONTS or `Drawn: <name>`),
 * drawn as `strokeOptions` say, or else a Google font from the Fontsource CDN.
 */
export async function loadFontFamily(family: string, strokeOptions: Partial<StrokeFontOptions>): Promise<LoadedFontSource> {
  const stroke = await strokeFontFor(family);
  if (stroke) return loadStrokeFont(stroke, strokeOptions);
  const { primary, extra } = await fetchFontFromCDN(family);
  // Fontsource's subsets carry no name table, so the family is passed in.
  const info = await parseFont(primary, extra.length > 0 ? extra : undefined, family);
  return { info, buffer: primary, extraBuffers: extra.length > 0 ? extra : undefined };
}
