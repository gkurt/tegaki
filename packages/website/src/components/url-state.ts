import type { TegakiEffectConfigs, TegakiMultiEffectName } from 'tegaki';
import {
  CHARSET_PRESETS,
  DEFAULT_CHARS,
  DEFAULT_GEOMETRY_OPTIONS,
  DEFAULT_OPTIONS,
  type GeometryOptions,
  type PipelineOptions,
} from 'tegaki-generator';
import {
  EASING_PRESETS,
  GEOMETRY_STAGES,
  type GeometryStageKey,
  type Pipeline,
  type PreviewMode,
  STAGES,
  type Stage,
} from './preview/constants.ts';

/** All state that gets persisted to the URL */
export type TimeMode = 'controlled' | 'uncontrolled' | 'css';

export type EffectsState = {
  [K in keyof TegakiEffectConfigs]: { enabled: boolean } & Required<TegakiEffectConfigs[K]>;
};

export const DEFAULT_EFFECTS_STATE: EffectsState = {
  glow: { enabled: false, radius: 8, color: '#00ccff', offsetX: 0, offsetY: 0 },
  wobble: { enabled: false, amplitude: 1.5, frequency: 8, mode: 'sine' },
  pressureWidth: { enabled: true, strength: 1 },
  taper: { enabled: false, startLength: 0.15, endLength: 0.15 },
  strokeGradient: { enabled: false, colors: 'rainbow', saturation: 80, lightness: 55 },
  globalGradient: { enabled: false, colors: ['#ff0000', '#0000ff'], angle: 0 },
};

/** A duplicated (custom-keyed) effect instance. */
export interface CustomEffect {
  key: string;
  effect: TegakiMultiEffectName;
  enabled: boolean;
  config: Record<string, number | string>;
}

/** Default configs for creating new custom effect instances. */
export const EFFECT_DEFAULTS: Record<TegakiMultiEffectName, Record<string, number | string>> = {
  glow: { radius: 8, color: '#00ccff', offsetX: 0, offsetY: 0 },
};

export interface UrlState {
  fontFamily: string;
  chars: string;
  selectedChar: string;
  /**
   * Glyph mode: the selected character's form (ligature, alternate…) as its
   * `glyphDataById` key — `"<gid>"`, or `"<subset>:<gid>"` in an extra font
   * subset. Null for the character's default glyph.
   */
  selectedForm: string | null;
  activeStage: Stage;
  previewMode: PreviewMode;
  previewText: string;
  options: PipelineOptions;
  /** Which stroke-extraction pipeline the glyph inspector visualizes. */
  pipeline: Pipeline;
  /** Active stage tab in the geometry pipeline (glyph inspector). */
  geometryStage: GeometryStageKey;
  /** Tunables for the geometry pipeline. */
  geometryOptions: GeometryOptions;
  // Text preview settings
  animSpeed: number;
  fontSizePx: number;
  lineHeightRatio: number;
  /** Extra spacing between characters, in px (CSS `letter-spacing`). */
  letterSpacingPx: number;
  /** Width of the text frame in px (null = fill the available space). `/preview` reads the same `w` as its container width. */
  frameWidth: number | null;
  /** The character set is every glyph the font maps (`cs=all`) — expanded into `chars` once the font loads. */
  allChars: boolean;
  showOverlay: boolean;
  timeMode: TimeMode;
  /**
   * Paused timeline position in seconds (controlled mode). When present and > 0 on load,
   * the text preview starts paused at this time — useful for agents inspecting a specific
   * frame by editing the URL.
   */
  currentTime: number;
  loop: boolean;
  catchUp: number;
  effectsState: EffectsState;
  customEffects: CustomEffect[];
  /** Render-quality knobs — see {@link TegakiQuality}. Flattened into URL keys `pr` / `ss` / `ct_` / `sm`. */
  quality: { pixelRatio: number; segmentSize: number; clipText: boolean | number; smoothing: boolean };
  strokeEasing: string;
  glyphEasing: string;
  /** Defer disconnected marks (i-dots, nuqṭa, diacritics) to after every body stroke in a word. */
  deferDots: boolean;
  /** Run text through the harfbuzz shaper for ligatures / contextual forms / RTL. Off falls back to the char-keyed glyph path. */
  useShaper: boolean;
  /** Enable stagger timing — each letter starts a fixed advance after the previous one. */
  staggerEnabled: boolean;
  /** Stagger advance. Numeric string = seconds; trailing `%` = percentage of previous glyph's bundled duration. */
  staggerAdvance: string;
  /** Stagger per-glyph duration. `'auto'` keeps bundled timing; numeric string scales strokes to that many seconds. */
  staggerDuration: string;
}

/**
 * The pipeline's default for Clip to text. Ink-graph strokes stay inside the
 * glyph but leave thin slivers along its edges; widened ×1.2 and clipped to
 * the text they fill them, painting little ahead of the stroke that owns the
 * ink. Raster strokes already overshoot the outline, so they stay unclipped.
 */
export function defaultClipText(pipeline: Pipeline): boolean | number {
  return pipeline === 'geometry' ? 1.2 : false;
}

export const URL_DEFAULTS: UrlState = {
  fontFamily: 'Caveat',
  chars: DEFAULT_CHARS,
  selectedChar: 'A',
  selectedForm: null,
  activeStage: 'final',
  previewMode: 'text',
  previewText: 'Hello World',
  options: DEFAULT_OPTIONS,
  pipeline: 'geometry',
  geometryStage: 'strokes',
  geometryOptions: DEFAULT_GEOMETRY_OPTIONS,
  animSpeed: 1,
  fontSizePx: 128,
  lineHeightRatio: 1.5,
  letterSpacingPx: 0,
  frameWidth: null,
  allChars: false,
  showOverlay: false,
  timeMode: 'controlled',
  currentTime: 0,
  loop: false,
  catchUp: 0,
  effectsState: DEFAULT_EFFECTS_STATE,
  customEffects: [],
  quality: { pixelRatio: 1, segmentSize: 2, clipText: defaultClipText('geometry'), smoothing: false },
  strokeEasing: 'default',
  glyphEasing: 'default',
  deferDots: true,
  useShaper: true,
  staggerEnabled: false,
  staggerAdvance: '0.2',
  staggerDuration: 'auto',
};

// Short keys for compact URLs — only non-default values are written
const OPTION_KEYS: Record<keyof PipelineOptions, string> = {
  resolution: 'res',
  skeletonMethod: 'sk',
  lineCap: 'lc',
  bezierTolerance: 'bt',
  rdpTolerance: 'rt',
  spurLengthRatio: 'sl',
  mergeThresholdRatio: 'mr',
  traceLookback: 'tl',
  curvatureBias: 'cb',
  thinMaxIterations: 'ti',
  junctionCleanupIterations: 'jc',
  dtMethod: 'dt',
  voronoiSamplingInterval: 'vs',
  drawingSpeed: 'ds',
  strokePause: 'sp',
  disabledFeatures: 'df',
};

const REVERSE_OPTION_KEYS = Object.fromEntries(Object.entries(OPTION_KEYS).map(([k, v]) => [v, k])) as Record<
  string,
  keyof PipelineOptions
>;

// Geometry-pipeline option short keys (numeric except the enums and inkSerifs).
const GEO_OPTION_KEYS: Record<keyof GeometryOptions, string> = {
  cornerAngleThresholdDeg: 'gca',
  cornerWindowRatio: 'gcw',
  cutAlignToleranceDeg: 'gct',
  maxCutLengthFactor: 'gml',
  junctionCompactness: 'gjc',
  continuationMaxBendDeg: 'gcb',
  resampleSpacingRatio: 'grs',
  medialMethod: 'gmm',
  strokeOrder: 'gso',
  hanLocale: 'ghl',
  extraction: 'gx',
  inkSampleRatio: 'gis',
  inkSpurTolerance: 'gip',
  inkJunctionReach: 'gij',
  inkSerifs: 'gsf',
};

const MEDIAL_METHODS: readonly GeometryOptions['medialMethod'][] = ['chain', 'voronoi', 'straight-skeleton'];
const STROKE_ORDER_MODES: readonly GeometryOptions['strokeOrder'][] = ['auto', 'dataset', 'heuristic'];
const EXTRACTION_MODES: readonly GeometryOptions['extraction'][] = ['partition', 'ink-graph'];
const HAN_LOCALES: readonly GeometryOptions['hanLocale'][] = ['ja', 'zh'];

const REVERSE_GEO_OPTION_KEYS = Object.fromEntries(Object.entries(GEO_OPTION_KEYS).map(([k, v]) => [v, k])) as Record<
  string,
  keyof GeometryOptions
>;

// Allowed values for enum-like URL params. Unknown values (stale or mistyped
// shared URLs) fall back to the default instead of poisoning typed state.
const STAGE_KEYS = STAGES.map((s) => s.key);
const GEOMETRY_STAGE_KEYS = GEOMETRY_STAGES.map((s) => s.key);
const EASING_KEYS = EASING_PRESETS.map((e) => e.key);
const PREVIEW_MODES: readonly PreviewMode[] = ['glyph', 'text'];
const PIPELINES: readonly Pipeline[] = ['raster', 'geometry'];
const TIME_MODES: readonly TimeMode[] = ['controlled', 'uncontrolled', 'css'];

// ── Character set ─────────────────────────────────────────────────────────
// A charset preset is written by name (`cs=korean`) and an edited one as the
// difference from its closest preset — `ch` holds characters appended after it
// and `cr` the ones taken out — instead of spelling out every character.
// Sets that don't reduce to a preset exactly (same characters, same order)
// fall back to the raw `ch`, which is also how older URLs read.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);

export const charsetSlug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

export interface CharsetEncoding {
  /** Preset slug, e.g. `korean`. */
  preset: string;
  /** Characters appended after the preset's. */
  added: string;
  /** Preset characters left out. */
  removed: string;
}

/** Rebuild a character set from a preset plus its edits. Null for an unknown preset. */
export function decodeChars({ preset, added, removed }: CharsetEncoding): string | null {
  const base = CHARSET_PRESETS.find((p) => charsetSlug(p.name) === preset);
  if (!base) return null;
  const drop = new Set(graphemes(removed));
  return (
    graphemes(base.chars)
      .filter((c) => !drop.has(c))
      .join('') + added
  );
}

/**
 * The shortest preset-relative spelling of `chars`, or null when no preset
 * reproduces it exactly or the raw characters would be shorter.
 */
export function encodeChars(chars: string): CharsetEncoding | null {
  const target = graphemes(chars);
  const present = new Set(target);
  let best: CharsetEncoding | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const { name, chars: presetChars } of CHARSET_PRESETS) {
    const base = graphemes(presetChars);
    const kept = base.filter((c) => present.has(c));
    // The kept preset characters must lead, in order, for the edit to be exact.
    if (kept.some((c, i) => target[i] !== c)) continue;
    const enc = {
      preset: charsetSlug(name),
      added: target.slice(kept.length).join(''),
      removed: base.filter((c) => !present.has(c)).join(''),
    };
    const cost = enc.added.length + enc.removed.length;
    if (cost < bestCost && decodeChars(enc) === chars) {
      best = enc;
      bestCost = cost;
    }
  }
  return best && bestCost < chars.length ? best : null;
}

function parseEnum<T extends string>(raw: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Read URL state from the given search params (defaults to the current location). Returns only overrides (merged with defaults). */
export function parseUrlState(search: string | URLSearchParams = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const state: UrlState = {
    ...URL_DEFAULTS,
    options: { ...DEFAULT_OPTIONS },
    geometryOptions: { ...DEFAULT_GEOMETRY_OPTIONS },
  };

  if (p.has('f')) state.fontFamily = p.get('f')!;
  const preset = p.get('cs');
  if (preset === 'all') state.allChars = true;
  const presetChars = preset === null ? null : decodeChars({ preset, added: p.get('ch') ?? '', removed: p.get('cr') ?? '' });
  if (presetChars !== null) state.chars = presetChars;
  else if (p.has('ch')) state.chars = p.get('ch')!;
  if (p.has('g')) state.selectedChar = p.get('g')!;
  if (p.has('gv')) {
    const form = p.get('gv')!;
    state.selectedForm = /^(\d+:)?[1-9]\d*$/.test(form) ? form : null;
  }
  if (p.has('s')) state.activeStage = parseEnum(p.get('s')!, STAGE_KEYS, URL_DEFAULTS.activeStage);
  if (p.has('m')) state.previewMode = parseEnum(p.get('m')!, PREVIEW_MODES, URL_DEFAULTS.previewMode);
  if (p.has('t')) state.previewText = p.get('t')!;
  if (p.has('as')) state.animSpeed = Number(p.get('as'));
  if (p.has('fs')) state.fontSizePx = Number(p.get('fs'));
  if (p.has('lh')) state.lineHeightRatio = Number(p.get('lh'));
  if (p.has('ls')) state.letterSpacingPx = Number(p.get('ls'));
  if (p.has('w')) {
    const w = Number(p.get('w'));
    state.frameWidth = Number.isFinite(w) && w > 0 ? Math.round(w) : null;
  }
  if (p.has('ol')) state.showOverlay = p.get('ol') === '1';
  if (p.has('tm')) state.timeMode = parseEnum(p.get('tm')!, TIME_MODES, URL_DEFAULTS.timeMode);
  if (p.has('ct')) {
    const v = Number(p.get('ct'));
    if (Number.isFinite(v) && v >= 0) state.currentTime = v;
  }
  if (p.has('lo')) state.loop = p.get('lo') === '1';
  if (p.has('cu')) state.catchUp = Number(p.get('cu'));
  if (p.has('fx')) {
    try {
      state.effectsState = { ...DEFAULT_EFFECTS_STATE, ...JSON.parse(p.get('fx')!) };
    } catch {}
  }
  if (p.has('cx')) {
    try {
      state.customEffects = JSON.parse(p.get('cx')!);
    } catch {}
  }
  if (p.has('ss')) state.quality = { ...state.quality, segmentSize: Number(p.get('ss')) };
  if (p.has('pr')) state.quality = { ...state.quality, pixelRatio: Number(p.get('pr')) };
  if (p.has('ct_')) {
    const raw = p.get('ct_')!;
    const num = Number(raw);
    state.quality = { ...state.quality, clipText: raw === '1' ? true : Number.isFinite(num) && num > 0 ? num : false };
  }
  if (p.has('sm')) state.quality = { ...state.quality, smoothing: p.get('sm') === '1' };
  if (p.has('se')) state.strokeEasing = parseEnum(p.get('se')!, EASING_KEYS, URL_DEFAULTS.strokeEasing);
  if (p.has('ge')) state.glyphEasing = parseEnum(p.get('ge')!, EASING_KEYS, URL_DEFAULTS.glyphEasing);
  if (p.has('dd')) state.deferDots = p.get('dd') !== '0';
  if (p.has('hb')) state.useShaper = p.get('hb') !== '0';
  if (p.has('st')) state.staggerEnabled = p.get('st') === '1';
  if (p.has('sa')) state.staggerAdvance = p.get('sa')!;
  if (p.has('sd')) state.staggerDuration = p.get('sd')!;
  if (p.has('pl')) state.pipeline = parseEnum(p.get('pl')!, PIPELINES, URL_DEFAULTS.pipeline);
  if (p.has('gs')) state.geometryStage = parseEnum(p.get('gs')!, GEOMETRY_STAGE_KEYS, URL_DEFAULTS.geometryStage);

  // Pipeline options — read short keys
  for (const [short, long] of Object.entries(REVERSE_OPTION_KEYS)) {
    if (!p.has(short)) continue;
    const raw = p.get(short)!;
    const defaultVal = DEFAULT_OPTIONS[long];
    if (Array.isArray(defaultVal)) {
      (state.options as unknown as Record<string, unknown>)[long] = raw ? raw.split(',') : [];
    } else if (typeof defaultVal === 'number') {
      (state.options as unknown as Record<string, unknown>)[long] = Number(raw);
    } else {
      (state.options as unknown as Record<string, unknown>)[long] = raw;
    }
  }

  // Geometry options — numeric, except the enum-valued medialMethod / strokeOrder / hanLocale / extraction and boolean inkSerifs.
  for (const [short, long] of Object.entries(REVERSE_GEO_OPTION_KEYS)) {
    if (!p.has(short)) continue;
    const raw = p.get(short)!;
    if (long === 'medialMethod') {
      if ((MEDIAL_METHODS as readonly string[]).includes(raw)) state.geometryOptions.medialMethod = raw as GeometryOptions['medialMethod'];
      continue;
    }
    if (long === 'strokeOrder') {
      if ((STROKE_ORDER_MODES as readonly string[]).includes(raw))
        state.geometryOptions.strokeOrder = raw as GeometryOptions['strokeOrder'];
      continue;
    }
    if (long === 'hanLocale') {
      state.geometryOptions.hanLocale = parseEnum(raw, HAN_LOCALES, DEFAULT_GEOMETRY_OPTIONS.hanLocale);
      continue;
    }
    if (long === 'extraction') {
      state.geometryOptions.extraction = parseEnum(raw, EXTRACTION_MODES, DEFAULT_GEOMETRY_OPTIONS.extraction);
      continue;
    }
    if (long === 'inkSerifs') {
      state.geometryOptions.inkSerifs = raw !== 'false' && raw !== '0';
      continue;
    }
    const v = Number(raw);
    if (Number.isFinite(v)) (state.geometryOptions as unknown as Record<string, number>)[long] = v;
  }
  if (!p.has('ct_')) state.quality = { ...state.quality, clipText: defaultClipText(state.pipeline) };

  return state;
}

/** Build URLSearchParams from state, only including values that differ from defaults. */
export function buildUrlParams(state: UrlState): URLSearchParams {
  const p = new URLSearchParams();

  if (state.fontFamily !== URL_DEFAULTS.fontFamily) p.set('f', state.fontFamily);
  if (state.allChars) p.set('cs', 'all');
  else if (state.chars !== URL_DEFAULTS.chars) {
    const enc = encodeChars(state.chars);
    if (enc) {
      p.set('cs', enc.preset);
      if (enc.added) p.set('ch', enc.added);
      if (enc.removed) p.set('cr', enc.removed);
    } else {
      p.set('ch', state.chars);
    }
  }
  if (state.selectedChar !== URL_DEFAULTS.selectedChar) p.set('g', state.selectedChar);
  if (state.selectedForm !== null) p.set('gv', state.selectedForm);
  if (state.activeStage !== URL_DEFAULTS.activeStage) p.set('s', state.activeStage);
  if (state.previewMode !== URL_DEFAULTS.previewMode) p.set('m', state.previewMode);
  if (state.previewText !== URL_DEFAULTS.previewText) p.set('t', state.previewText);
  if (state.animSpeed !== URL_DEFAULTS.animSpeed) p.set('as', String(state.animSpeed));
  if (state.fontSizePx !== URL_DEFAULTS.fontSizePx) p.set('fs', String(state.fontSizePx));
  if (state.lineHeightRatio !== URL_DEFAULTS.lineHeightRatio) p.set('lh', String(state.lineHeightRatio));
  if (state.letterSpacingPx !== URL_DEFAULTS.letterSpacingPx) p.set('ls', String(state.letterSpacingPx));
  if (state.frameWidth !== null) p.set('w', String(state.frameWidth));
  if (state.showOverlay !== URL_DEFAULTS.showOverlay) p.set('ol', '1');
  if (state.timeMode !== URL_DEFAULTS.timeMode) p.set('tm', state.timeMode);
  if (state.currentTime !== URL_DEFAULTS.currentTime) p.set('ct', String(state.currentTime));
  if (state.loop !== URL_DEFAULTS.loop) p.set('lo', '1');
  if (state.catchUp !== URL_DEFAULTS.catchUp) p.set('cu', String(state.catchUp));
  if (JSON.stringify(state.effectsState) !== JSON.stringify(DEFAULT_EFFECTS_STATE)) {
    p.set('fx', JSON.stringify(state.effectsState));
  }
  if (state.customEffects.length > 0) {
    p.set('cx', JSON.stringify(state.customEffects));
  }
  if (state.quality.segmentSize !== URL_DEFAULTS.quality.segmentSize) p.set('ss', String(state.quality.segmentSize));
  if (state.quality.pixelRatio !== URL_DEFAULTS.quality.pixelRatio) p.set('pr', String(state.quality.pixelRatio));
  if (state.quality.clipText !== defaultClipText(state.pipeline)) {
    const clip = state.quality.clipText;
    p.set('ct_', clip === false ? '0' : typeof clip === 'number' ? String(clip) : '1');
  }
  if (state.quality.smoothing !== URL_DEFAULTS.quality.smoothing) p.set('sm', '1');
  if (state.strokeEasing !== URL_DEFAULTS.strokeEasing) p.set('se', state.strokeEasing);
  if (state.glyphEasing !== URL_DEFAULTS.glyphEasing) p.set('ge', state.glyphEasing);
  if (state.deferDots !== URL_DEFAULTS.deferDots) p.set('dd', '0');
  if (state.useShaper !== URL_DEFAULTS.useShaper) p.set('hb', '0');
  if (state.staggerEnabled !== URL_DEFAULTS.staggerEnabled) p.set('st', '1');
  if (state.staggerAdvance !== URL_DEFAULTS.staggerAdvance) p.set('sa', state.staggerAdvance);
  if (state.staggerDuration !== URL_DEFAULTS.staggerDuration) p.set('sd', state.staggerDuration);
  if (state.pipeline !== URL_DEFAULTS.pipeline) p.set('pl', state.pipeline);
  if (state.geometryStage !== URL_DEFAULTS.geometryStage) p.set('gs', state.geometryStage);

  // Geometry options — only non-defaults.
  for (const [long, short] of Object.entries(GEO_OPTION_KEYS)) {
    const key = long as keyof GeometryOptions;
    if (state.geometryOptions[key] !== DEFAULT_GEOMETRY_OPTIONS[key]) p.set(short, String(state.geometryOptions[key]));
  }

  // Pipeline options — only non-defaults. Array-valued options are serialized
  // as comma-separated and compared structurally.
  for (const [long, short] of Object.entries(OPTION_KEYS)) {
    const key = long as keyof PipelineOptions;
    const val = state.options[key];
    const def = DEFAULT_OPTIONS[key];
    if (Array.isArray(val) || Array.isArray(def)) {
      const a = Array.isArray(val) ? val : [];
      const b = Array.isArray(def) ? def : [];
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) p.set(short, a.join(','));
    } else if (val !== def) {
      p.set(short, String(val));
    }
  }

  return p;
}

/** Replace the current URL search params without a navigation/reload. */
export function syncUrlState(state: UrlState): void {
  const params = buildUrlParams(state);
  const search = params.toString();
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
  window.history.pushState(null, '', url);
}
