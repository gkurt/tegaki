// The home page writes a few words in each non-Latin bundle, but a bundle
// carries its whole character set: LXGW WenKai's is 4.5 MB of glyph data for
// the 6 characters the page draws in it. This Vite plugin serves those fonts
// as `tegaki-home-font:<dir>` modules — the shipped bundle cut down to the
// page's characters: the glyph data for them alone, and the font subset to
// them by hb-subset with its glyph ids kept, so `glyphDataById` and the
// shaper still agree. The full font stays the fallback, loaded only for a
// character the cut bundle lacks.
//
// Runs in the Vite config (Node, not Bun), so files are read with node:fs.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';

/**
 * The characters the home page writes in each font it cuts down, by family.
 * Every string a home island draws in one of these fonts must stay inside
 * its set (home-fonts.test.ts checks); the Latin fonts ship whole, since
 * the Type-it card takes any text.
 */
export const HOME_FONT_TEXT: Record<string, string> = {
  'Klee One': 'こんにちは手書き書',
  'LXGW WenKai': '你好手写字永',
  'Nanum Pen Script': '반가워요손글씨',
  'Suez One': 'שלום כתב יד',
  Amiri: 'مرحبا خط اليد',
  Tillana: 'नमस्ते हस्तलेखन',
  Atma: 'হাতের লেখা',
};

export const HOME_FONT_PREFIX = 'tegaki-home-font:';

/** A family's bundle directory under packages/renderer/fonts. */
export const fontDir = (family: string) => family.toLowerCase().replace(/\s+/g, '-');

const here = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(here, '../../renderer/fonts');
const CACHE_DIR = join(here, '../node_modules/.cache/tegaki-home-fonts');

interface HbSubset {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, setType: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
/** Glyph ids stay as they were (the dropped glyphs left empty), so `glyphDataById` keys still match. */
const HB_SUBSET_FLAGS_RETAIN_GIDS = 2;

let hbSubset: HbSubset | undefined;

function loadHbSubset(): HbSubset {
  if (!hbSubset) {
    // harfbuzzjs' exports map only exposes its JS entry; the subset wasm sits beside it.
    const wasm = join(dirname(createRequire(import.meta.url).resolve('harfbuzzjs')), 'harfbuzz-subset.wasm');
    hbSubset = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm))).exports as unknown as HbSubset;
  }
  return hbSubset;
}

/** `font` subset to `chars` with every layout feature and the glyph ids kept. */
export function subsetKeepingGlyphIds(font: Uint8Array, chars: string): Uint8Array {
  const hb = loadHbSubset();
  const fontPtr = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const char of new Set(chars)) hb.hb_set_add(unicodes, char.codePointAt(0)!);
  // The feature set starts filled with HarfBuzz's defaults; cleared then inverted it is "all".
  const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  hb.hb_set_clear(features);
  hb.hb_set_invert(features);
  hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_RETAIN_GIDS);
  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  try {
    if (subset === 0) throw new Error('hb-subset: subsetting failed');
    const outBlob = hb.hb_face_reference_blob(subset);
    const out = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(outBlob, 0), hb.hb_blob_get_length(outBlob)).slice();
    hb.hb_blob_destroy(outBlob);
    return out;
  } finally {
    if (subset !== 0) hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}

/**
 * A shipped bundle.ts read as its object, with each import it makes (the
 * fonts, the glyph data) standing in as a `\0name` placeholder, and the
 * files those imports name.
 */
function readBundleModule(dir: string): { bundle: Record<string, unknown>; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const body = readFileSync(join(dir, 'bundle.ts'), 'utf8')
    .replace(/^import (\w+) from '\.\/([^']+)'.*$/gm, (_, name: string, file: string) => {
      files[name] = file;
      return '';
    })
    .replace(/\bas const\b/, '')
    .replace(/export default bundle;/, 'return bundle;');
  const names = Object.keys(files);
  const bundle = new Function(...names, body)(...names.map((n) => `\0${n}`)) as Record<string, unknown>;
  return { bundle, files };
}

/** The glyph ids `font` (subset with ids kept) still draws. */
function drawnGlyphIds(font: Uint8Array): Set<string> {
  const parsed = opentype.parse(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer);
  const ids = new Set<string>();
  for (let i = 0; i < parsed.glyphs.length; i++) {
    if (parsed.glyphs.get(i).path.commands.length > 0) ids.add(String(i));
  }
  return ids;
}

/** The `tegaki-home-font:<dir>` module: `family`'s bundle cut down to `chars`. */
export function homeFontModule(family: string, chars: string): string {
  const dir = join(FONTS_DIR, fontDir(family));
  const { bundle, files } = readBundleModule(dir);
  const fontFile = files[String(bundle.fontUrl).slice(1)];
  if (!fontFile || bundle.extraFontUrls) throw new Error(`${family}: expected a bundle with one font subset`);

  const source = readFileSync(join(dir, fontFile));
  const hash = createHash('sha256').update(source).update(chars).digest('hex').slice(0, 8);
  const subsetPath = join(CACHE_DIR, `${fontDir(family)}-home-${hash}.ttf`);
  let subset: Uint8Array;
  if (existsSync(subsetPath)) subset = readFileSync(subsetPath);
  else {
    subset = subsetKeepingGlyphIds(source, chars);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(subsetPath, subset);
  }

  const charSet = new Set(chars);
  const glyphData = JSON.parse(readFileSync(join(dir, files.glyphData!), 'utf8')) as Record<string, unknown>;
  const keptGlyphs = Object.fromEntries(Object.entries(glyphData).filter(([key]) => [...key].every((c) => charSet.has(c))));
  let keptById: Record<string, unknown> | undefined;
  if (files.glyphDataById) {
    const drawn = drawnGlyphIds(subset);
    const byId = JSON.parse(readFileSync(join(dir, files.glyphDataById), 'utf8')) as Record<string, unknown>;
    keptById = Object.fromEntries(Object.entries(byId).filter(([id]) => drawn.has(id)));
  }

  // Its own family name, so it never shares a face with the full bundle.
  const familyName = `${bundle.family} Home`;
  const fullFontFile = bundle.fullFontUrl ? files[String(bundle.fullFontUrl).slice(1)] : undefined;
  const lines = [`import fontUrl from ${JSON.stringify(`${subsetPath.replaceAll('\\', '/')}?url`)};`];
  if (fullFontFile) lines.push(`import fullFontUrl from ${JSON.stringify(`${join(dir, fullFontFile).replaceAll('\\', '/')}?url`)};`);
  const fields: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    if (key === 'family') fields.push(`family: ${JSON.stringify(familyName)}`);
    else if (key === 'fontUrl') fields.push('fontUrl');
    else if (key === 'fullFontUrl') fields.push('fullFontUrl');
    else if (key === 'glyphData') fields.push(`glyphData: JSON.parse(${JSON.stringify(JSON.stringify(keptGlyphs))})`);
    else if (key === 'glyphDataById') fields.push(`glyphDataById: JSON.parse(${JSON.stringify(JSON.stringify(keptById))})`);
    else if (key === 'fontFaceCSS') {
      const rules = [`@font-face { font-family: '${familyName}'; src: url(\${fontUrl}); }`];
      if (fullFontFile) rules.push(`@font-face { font-family: '${bundle.fullFamily}'; src: url(\${fullFontUrl}); }`);
      fields.push(`fontFaceCSS: \`${rules.join(' ')}\``);
    } else fields.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push(`export default {\n  ${fields.join(',\n  ')},\n};`);
  return lines.join('\n');
}

/** The Vite plugin: `import('tegaki-home-font:klee-one')` is Klee One cut down to {@link HOME_FONT_TEXT}. */
export function homeFonts() {
  return {
    name: 'tegaki:home-fonts',
    resolveId(id: string) {
      return id.startsWith(HOME_FONT_PREFIX) ? `\0${id}` : null;
    },
    load(id: string) {
      if (!id.startsWith(`\0${HOME_FONT_PREFIX}`)) return null;
      const dir = id.slice(HOME_FONT_PREFIX.length + 1);
      const family = Object.keys(HOME_FONT_TEXT).find((f) => fontDir(f) === dir);
      if (family === undefined) throw new Error(`${HOME_FONT_PREFIX}${dir}: no family in HOME_FONT_TEXT`);
      return homeFontModule(family, HOME_FONT_TEXT[family]!);
    },
  };
}
