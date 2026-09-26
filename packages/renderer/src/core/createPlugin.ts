import type { TegakiPlugin } from './types.ts';

// ---------------------------------------------------------------------------
// Params: what a plugin can be set to, described so a UI can build controls
// ---------------------------------------------------------------------------

interface ParamBase {
  /** What a control for it is called. Defaults to the param's key. */
  label?: string;
  /** A line on what it changes. */
  description?: string;
}

/** A number, kept within `min`–`max` when set. */
export interface TegakiNumberParam extends ParamBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  /** The increment a slider moves by. */
  step?: number;
}

/** A switch. */
export interface TegakiBooleanParam extends ParamBase {
  type: 'boolean';
  default: boolean;
}

/** One of a few strings. */
export interface TegakiSelectParam<V extends string = string> extends ParamBase {
  type: 'select';
  default: NoInfer<V>;
  /** The values it can take, each bare or with a label for a control. */
  options: readonly (V | { value: V; label: string })[];
}

/** A CSS color. */
export interface TegakiColorParam extends ParamBase {
  type: 'color';
  default: string;
}

export type TegakiPluginParam = TegakiNumberParam | TegakiBooleanParam | TegakiSelectParam | TegakiColorParam;

/** A plugin's params, by key. */
export type TegakiPluginParams = Record<string, TegakiPluginParam>;

type ParamValue<P> = P extends TegakiNumberParam
  ? number
  : P extends TegakiBooleanParam
    ? boolean
    : P extends TegakiSelectParam<infer V>
      ? V
      : P extends TegakiColorParam
        ? string
        : never;

/** The values a plugin's params are set to, one per key. */
export type TegakiPluginOptions<P extends TegakiPluginParams> = { -readonly [K in keyof P]: ParamValue<P[K]> };

// ---------------------------------------------------------------------------
// createPlugin
// ---------------------------------------------------------------------------

/** What {@link createPlugin} makes a plugin from. */
export interface TegakiPluginDefinition<P extends TegakiPluginParams> {
  /** Names the plugins it makes (their `name`). */
  name: string;
  /** What a UI calls it. Defaults to `name`. */
  label?: string;
  /** A line on what it does. */
  description?: string;
  /** What it can be set to. */
  params?: P;
  /** Named settings worth trying, each a few of the params changed from their defaults. */
  presets?: Record<string, Partial<TegakiPluginOptions<P>>>;
  /**
   * Make one plugin: the hooks for `options`, every param set (defaults filled
   * in, numbers kept in range). Called once per plugin made, so state kept in
   * its closure — caches, a peak level — belongs to that plugin alone.
   */
  setup(options: TegakiPluginOptions<P>): Omit<TegakiPlugin, 'name'>;
}

/**
 * Makes plugins from a definition: call it with the options you want changed,
 * and read what it can be set to from its `params`, `defaults` and `presets`.
 * Without a type argument it's any factory, for lists of several.
 */
export interface TegakiPluginFactory<P extends TegakiPluginParams = any> {
  (options?: Partial<TegakiPluginOptions<P>>): TegakiPlugin;
  readonly name: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly params: P;
  readonly defaults: TegakiPluginOptions<P>;
  readonly presets: Readonly<Record<string, Partial<TegakiPluginOptions<P>>>>;
  /** Every param set from `input`: what's missing, of the wrong type or not an option takes its default, numbers are kept in range, unknown keys are dropped. */
  resolve(input?: unknown): TegakiPluginOptions<P>;
}

/**
 * Define a plugin that takes options. The factory it returns makes a plugin
 * per call, with the options passed over the defaults:
 *
 * ```ts
 * const shadow = createPlugin({
 *   name: 'shadow',
 *   params: {
 *     offset: { type: 'number', default: 4, min: 0, max: 20 },
 *     color: { type: 'color', default: 'rgba(40, 80, 200, 0.35)' },
 *   },
 *   setup: ({ offset, color }) => ({
 *     paint(s, next) {
 *       const path = s.stroke.path.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset }));
 *       next({ ...s, style: color, stroke: { ...s.stroke, path } });
 *       next(s);
 *     },
 *   }),
 * });
 *
 * plugins: [shadow({ offset: 8 })]
 * ```
 *
 * The params describe the options well enough for a UI to build a control
 * for each (the studio's Plugins tab does), and {@link TegakiPluginFactory.resolve}
 * makes options read from a URL or a file safe to pass.
 */
export function createPlugin<const P extends TegakiPluginParams = {}>(definition: TegakiPluginDefinition<P>): TegakiPluginFactory<P> {
  const params = (definition.params ?? {}) as P;
  const defaults = pluginDefaults(params);
  const resolve = (input?: unknown) => resolvePluginOptions(params, input);
  const factory = (options?: Partial<TegakiPluginOptions<P>>): TegakiPlugin => ({
    ...definition.setup(resolve(options)),
    name: definition.name,
  });
  // A function's own `name` is read-only, so it's redefined rather than assigned.
  Object.defineProperty(factory, 'name', { value: definition.name });
  return Object.assign(factory, {
    label: definition.label ?? definition.name,
    description: definition.description,
    params,
    defaults,
    presets: definition.presets ?? {},
    resolve,
  }) as TegakiPluginFactory<P>;
}

/** Each param's default. */
export function pluginDefaults<P extends TegakiPluginParams>(params: P): TegakiPluginOptions<P> {
  const out: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(params)) out[key] = param.default;
  return out as TegakiPluginOptions<P>;
}

/** The values a select param can take. */
export function selectValues(param: TegakiSelectParam): string[] {
  return param.options.map((o) => (typeof o === 'string' ? o : o.value));
}

/** `value` as `param` takes it, or `undefined` if it can't: a number kept in range, a select value among the options. */
export function resolveParam(param: TegakiPluginParam, value: unknown): TegakiPluginParam['default'] | undefined {
  switch (param.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, value));
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'select':
      return typeof value === 'string' && selectValues(param).includes(value) ? value : undefined;
    case 'color':
      return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

/** Every param set from `input` (see {@link TegakiPluginFactory.resolve}). */
export function resolvePluginOptions<P extends TegakiPluginParams>(params: P, input?: unknown): TegakiPluginOptions<P> {
  const given = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(params)) {
    const value = Object.hasOwn(given, key) ? resolveParam(param, given[key]) : undefined;
    out[key] = value ?? param.default;
  }
  return out as TegakiPluginOptions<P>;
}

/** The options in `options` that differ from their params' defaults — what's worth writing down (in a URL, say). */
export function changedPluginOptions<P extends TegakiPluginParams>(
  params: P,
  options: Partial<TegakiPluginOptions<P>> | Readonly<Record<string, unknown>>,
): Partial<TegakiPluginOptions<P>> {
  const out: Record<string, unknown> = {};
  const resolved = resolvePluginOptions(params, options) as Record<string, unknown>;
  for (const [key, param] of Object.entries(params)) {
    if (Object.hasOwn(options, key) && resolved[key] !== param.default) out[key] = resolved[key];
  }
  return out as Partial<TegakiPluginOptions<P>>;
}
