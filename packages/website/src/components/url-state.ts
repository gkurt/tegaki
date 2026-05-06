import type { TegakiEffectConfigs, TegakiMultiEffectName } from 'tegaki';
import { DEFAULT_CHARS, DEFAULT_OPTIONS, type PipelineOptions } from 'tegaki-generator';

type Stage =
  | 'outline'
  | 'flattened'
  | 'bitmap'
  | 'skeleton'
  | 'overlay'
  | 'distance'
  | 'traced'
  | 'curvature'
  | 'strokes'
  | 'animation'
  | 'final';
type PreviewMode = 'glyph' | 'text';

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
  activeStage: Stage;
  previewMode: PreviewMode;
  previewText: string;
  options: PipelineOptions;
  // Text preview settings
  animSpeed: number;
  fontSizePx: number;
  lineHeightRatio: number;
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
}

export const URL_DEFAULTS: UrlState = {
  fontFamily: 'Caveat',
  chars: DEFAULT_CHARS,
  selectedChar: 'A',
  activeStage: 'final',
  previewMode: 'text',
  previewText: 'Hello World',
  options: DEFAULT_OPTIONS,
  animSpeed: 1,
  fontSizePx: 128,
  lineHeightRatio: 1.5,
  showOverlay: false,
  timeMode: 'controlled',
  currentTime: 0,
  loop: false,
  catchUp: 0,
  effectsState: DEFAULT_EFFECTS_STATE,
  customEffects: [],
  quality: { pixelRatio: 1, segmentSize: 2, clipText: false, smoothing: false },
  strokeEasing: 'default',
  glyphEasing: 'default',
  deferDots: true,
  useShaper: true,
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

/** Read URL state from the current location search params. Returns only overrides (merged with defaults). */
export function parseUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const state: UrlState = { ...URL_DEFAULTS, options: { ...DEFAULT_OPTIONS } };

  if (p.has('f')) state.fontFamily = p.get('f')!;
  if (p.has('ch')) state.chars = p.get('ch')!;
  if (p.has('g')) state.selectedChar = p.get('g')!;
  if (p.has('s')) state.activeStage = p.get('s') as Stage;
  if (p.has('m')) state.previewMode = p.get('m') as PreviewMode;
  if (p.has('t')) state.previewText = p.get('t')!;
  if (p.has('as')) state.animSpeed = Number(p.get('as'));
  if (p.has('fs')) state.fontSizePx = Number(p.get('fs'));
  if (p.has('lh')) state.lineHeightRatio = Number(p.get('lh'));
  if (p.has('ol')) state.showOverlay = p.get('ol') === '1';
  if (p.has('tm')) state.timeMode = p.get('tm') as TimeMode;
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
  if (p.has('se')) state.strokeEasing = p.get('se')!;
  if (p.has('ge')) state.glyphEasing = p.get('ge')!;
  if (p.has('dd')) state.deferDots = p.get('dd') !== '0';
  if (p.has('hb')) state.useShaper = p.get('hb') !== '0';

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

  return state;
}

/** Build URLSearchParams from state, only including values that differ from defaults. */
export function buildUrlParams(state: UrlState): URLSearchParams {
  const p = new URLSearchParams();

  if (state.fontFamily !== URL_DEFAULTS.fontFamily) p.set('f', state.fontFamily);
  if (state.chars !== URL_DEFAULTS.chars) p.set('ch', state.chars);
  if (state.selectedChar !== URL_DEFAULTS.selectedChar) p.set('g', state.selectedChar);
  if (state.activeStage !== URL_DEFAULTS.activeStage) p.set('s', state.activeStage);
  if (state.previewMode !== URL_DEFAULTS.previewMode) p.set('m', state.previewMode);
  if (state.previewText !== URL_DEFAULTS.previewText) p.set('t', state.previewText);
  if (state.animSpeed !== URL_DEFAULTS.animSpeed) p.set('as', String(state.animSpeed));
  if (state.fontSizePx !== URL_DEFAULTS.fontSizePx) p.set('fs', String(state.fontSizePx));
  if (state.lineHeightRatio !== URL_DEFAULTS.lineHeightRatio) p.set('lh', String(state.lineHeightRatio));
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
  if (state.quality.clipText !== URL_DEFAULTS.quality.clipText) {
    p.set('ct_', typeof state.quality.clipText === 'number' ? String(state.quality.clipText) : '1');
  }
  if (state.quality.smoothing !== URL_DEFAULTS.quality.smoothing) p.set('sm', '1');
  if (state.strokeEasing !== URL_DEFAULTS.strokeEasing) p.set('se', state.strokeEasing);
  if (state.glyphEasing !== URL_DEFAULTS.glyphEasing) p.set('ge', state.glyphEasing);
  if (state.deferDots !== URL_DEFAULTS.deferDots) p.set('dd', '0');
  if (state.useShaper !== URL_DEFAULTS.useShaper) p.set('hb', '0');

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
