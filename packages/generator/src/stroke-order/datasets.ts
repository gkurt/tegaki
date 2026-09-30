// The stroke-order reference datasets the generator can consult, for the
// `referenceDatasets` option (CLI `--reference-datasets`, the Studio's
// Pipeline tab). Every dataset that answers for a character offers its
// strokes as one variant, and the pipeline adopts whichever fits the font's
// ink best — so turning a dataset off can only take variants away; turning
// one on lets its hand compete (see `createReferenceSet`).

export interface ReferenceDataset {
  /** Stable id, as the option and URLs carry it. */
  id: string;
  name: string;
  /** What it covers, and in which hand. */
  description: string;
  /** Where it comes from. */
  url: string;
  license: string;
}

export const REFERENCE_DATASETS = [
  {
    id: 'kanjivg',
    name: 'KanjiVG',
    description: 'Japanese kanji and kana in textbook order; also print Latin and digits',
    url: 'https://kanjivg.tagaini.net',
    license: 'CC BY-SA 3.0',
  },
  {
    id: 'makemeahanzi',
    name: 'Make Me a Hanzi',
    description: 'Chinese hanzi in PRC order',
    url: 'https://github.com/skishore/makemeahanzi',
    license: 'Arphic Public License',
  },
  {
    id: 'hershey-script',
    name: 'Hershey Script',
    description: 'Formal cursive Latin letters, a joined letter in one pen motion',
    url: 'https://github.com/kamalmostafa/hershey-fonts',
    license: 'Hershey Fonts: free use with acknowledgement',
  },
  {
    id: 'hershey-simplex',
    name: 'Hershey Simplex',
    description: 'Plain print Latin letters and digits',
    url: 'https://github.com/kamalmostafa/hershey-fonts',
    license: 'Hershey Fonts: free use with acknowledgement',
  },
  {
    id: 'hershey-greek',
    name: 'Hershey Greek',
    description: 'The Greek alphabet in plain print',
    url: 'https://github.com/kamalmostafa/hershey-fonts',
    license: 'Hershey Fonts: free use with acknowledgement',
  },
  {
    id: 'letterpaths-print',
    name: 'Letterpaths print',
    description: 'Print Latin letters as handwriting is taught',
    url: 'https://github.com/RobinL/letterpaths',
    license: 'MIT',
  },
  {
    id: 'letterpaths-cursive',
    name: 'Letterpaths cursive',
    description: 'Taught cursive lowercase with its joins, entering from the baseline or from the top',
    url: 'https://github.com/RobinL/letterpaths',
    license: 'MIT',
  },
  {
    id: 'hangul',
    name: 'Hangul jamo',
    description: 'Korean syllables composed from standard jamo stroke order',
    url: 'https://github.com/gkurt/tegaki',
    license: 'MIT',
  },
  {
    id: 'punctuation',
    name: 'Punctuation',
    description: 'Which way the comma and semicolon are written',
    url: 'https://github.com/gkurt/tegaki',
    license: 'MIT',
  },
] as const satisfies readonly ReferenceDataset[];

export type ReferenceDatasetId = (typeof REFERENCE_DATASETS)[number]['id'];

export const REFERENCE_DATASET_IDS = REFERENCE_DATASETS.map((d) => d.id) as ReferenceDatasetId[];

/** Every dataset: the pipeline picks the best-fitting variant per glyph. */
export const DEFAULT_REFERENCE_DATASETS: readonly ReferenceDatasetId[] = REFERENCE_DATASET_IDS;

export function isReferenceDatasetId(id: string): id is ReferenceDatasetId {
  return (REFERENCE_DATASET_IDS as string[]).includes(id);
}
