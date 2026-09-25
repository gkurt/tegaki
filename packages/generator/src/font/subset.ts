// Font subsetting via HarfBuzz's hb-subset (the wasm build harfbuzzjs ships
// beside its shaper). Local fonts need it: Google Fonts subsets on its side
// (`&text=`), but a font read from disk — LXGW WenKai is 25 MB — must be cut
// down to the generated characters before it goes into a bundle.
//
// Node/Bun only: the wasm is read from the installed harfbuzzjs package.

import { fileURLToPath } from 'node:url';

interface HbSubsetExports {
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
  hb_subset_or_fail(face: number, input: number): number;
}

/** HB_MEMORY_MODE_WRITABLE: HarfBuzz may use the buffer in place (it's ours, freed after). */
const HB_MEMORY_MODE_WRITABLE = 2;
/** HB_SUBSET_SETS_LAYOUT_FEATURE_TAG: which GSUB/GPOS features survive. */
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

let hbSubset: Promise<HbSubsetExports> | undefined;

function loadHbSubset(): Promise<HbSubsetExports> {
  hbSubset ??= (async () => {
    // harfbuzzjs' exports map only exposes its JS entry; the subset wasm sits beside it.
    const wasmUrl = new URL('./harfbuzz-subset.wasm', import.meta.resolve('harfbuzzjs'));
    const { instance } = await WebAssembly.instantiate(await Bun.file(fileURLToPath(wasmUrl)).arrayBuffer());
    return instance.exports as unknown as HbSubsetExports;
  })();
  return hbSubset;
}

/**
 * Subset a TrueType/OpenType font to the given characters, keeping every
 * layout feature the font declares (the glyph closure pulls in the variant
 * glyphs those features reach, which the generator turns into
 * glyphDataById entries), like the Google Fonts `&text=` kits.
 */
export async function subsetFont(font: ArrayBuffer | Uint8Array, chars: string): Promise<Uint8Array> {
  const hb = await loadHbSubset();
  const bytes = font instanceof Uint8Array ? font : new Uint8Array(font);

  const fontPtr = hb.malloc(bytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(bytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, bytes.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) {
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
    throw new Error('hb-subset: could not create a subset input');
  }
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const char of new Set(chars)) hb.hb_set_add(unicodes, char.codePointAt(0)!);
  // The feature set starts FILLED with HarfBuzz's default list (inverting it
  // as-is would keep everything but those); cleared then inverted it is "all".
  const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  hb.hb_set_clear(features);
  hb.hb_set_invert(features);

  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  try {
    if (subset === 0) throw new Error('hb-subset: subsetting failed (is this a TrueType/OpenType font?)');
    const outBlob = hb.hb_face_reference_blob(subset);
    // hb.memory.buffer is re-read: HarfBuzz may have grown the memory.
    const out = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(outBlob, 0), hb.hb_blob_get_length(outBlob)).slice();
    hb.hb_blob_destroy(outBlob);
    if (out.byteLength === 0) throw new Error('hb-subset: produced an empty font');
    return out;
  } finally {
    if (subset !== 0) hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}
