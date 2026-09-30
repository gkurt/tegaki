import type { TegakiPluginFactory } from './createPlugin.ts';
import type { TegakiPlugin, TegakiPluginSpec } from './types.ts';

// Plugins by name, the way font bundles are by family: register a factory
// once, then name it where only data can go — an HTML attribute, an Astro
// prop serialized for the client, a CLI flag, a JSON file.

const factories = new Map<string, TegakiPluginFactory>();
const listeners = new Set<(names: readonly string[]) => void>();

/**
 * Register plugin factories (made with `createPlugin`) so `plugins` can name
 * them: `'glow'`, or `['glow', { radius: 0.15 }]` with options. A factory is
 * registered under its `name`; registering another under the same name
 * replaces it. Renderers already waiting on a name pick it up.
 */
export function registerPlugin(...list: TegakiPluginFactory[]): void {
  const names: string[] = [];
  for (const factory of list) {
    if (typeof factory !== 'function' || !factory.name)
      throw new Error('registerPlugin: expected a plugin factory made with createPlugin().');
    factories.set(factory.name, factory);
    names.push(factory.name);
  }
  for (const listener of listeners) listener(names);
}

/** The factory registered under `name`. */
export function getPlugin(name: string): TegakiPluginFactory | undefined {
  return factories.get(name);
}

/** Be told the names of factories as they're registered. Returns the unsubscribe. */
export function onPluginRegistered(listener: (names: readonly string[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A named entry of a plugin list, as its name and options. */
function namedSpec(spec: TegakiPluginSpec): { name: string; options: unknown } | null {
  if (typeof spec === 'string') return { name: spec, options: undefined };
  if (Array.isArray(spec) && typeof spec[0] === 'string') return { name: spec[0], options: spec[1] };
  return null;
}

/** Whether a plugin list names every plugin — nothing in it is an object, so it survives JSON (an Astro prop sent to the client). */
export function isDeclarative(specs: readonly TegakiPluginSpec[]): boolean {
  return specs.every((spec) => namedSpec(spec) !== null);
}

/**
 * A plugin list written as text, as the `plugins` attribute of
 * `<tegaki-renderer>` takes it: a JSON array (`'["taper", ["glow", {"radius": 0.15}]]'`),
 * or names split by spaces or commas (`"taper glow"`). Empty or unset is
 * `undefined`; invalid JSON is an empty list, with a warning.
 */
export function parsePluginSpecs(value: string | null | undefined): TegakiPluginSpec[] | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as TegakiPluginSpec[];
    } catch {}
    console.warn(`[tegaki] plugins: expected a JSON array or plugin names, got ${JSON.stringify(text)}.`);
    return [];
  }
  return text.split(/[\s,]+/).filter(Boolean);
}

const warnedMissing = new Set<string>();

/**
 * Warn that `name` isn't registered — once the page has loaded, since the
 * script registering it may run after the renderer (Astro orders its
 * scripts as it likes), and only if it still isn't by then.
 */
function warnMissing(name: string): void {
  if (warnedMissing.has(name)) return;
  const check = () => {
    if (factories.has(name) || warnedMissing.has(name)) return;
    warnedMissing.add(name);
    console.warn(
      `[tegaki] No plugin registered as "${name}". Register its factory before naming it: ` +
        `\`TegakiEngine.registerPlugin(${name}Plugin)\` (for a built-in plugin, import it from 'tegaki/core').`,
    );
  };
  if (typeof document === 'undefined' || typeof window === 'undefined' || document.readyState === 'complete') check();
  else window.addEventListener('load', check, { once: true });
}

/** What {@link PluginResolver.resolve} makes of a plugin list. */
export interface ResolvedPlugins {
  plugins: readonly TegakiPlugin[];
  /** The names in the list no factory is registered under. */
  missing: readonly string[];
}

/**
 * Turns plugin lists into plugins, keeping the plugin made for a named
 * entry as long as a later list names it with the same options — so a
 * renderer given a new array of the same names every render keeps its
 * plugins' caches and attachments. Plugin objects pass through as they are.
 */
export class PluginResolver {
  private made = new Map<string, TegakiPlugin>();
  /** Which factory made each plugin, so a factory registered again under the same name makes new ones. */
  private madeBy = new WeakMap<TegakiPlugin, TegakiPluginFactory>();

  resolve(specs: readonly TegakiPluginSpec[] | undefined, { warn = true }: { warn?: boolean } = {}): ResolvedPlugins {
    const plugins: TegakiPlugin[] = [];
    const missing: string[] = [];
    const made = new Map<string, TegakiPlugin>();
    const seen = new Map<string, number>();
    for (const spec of specs ?? []) {
      const named = namedSpec(spec);
      if (!named) {
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) plugins.push(spec as TegakiPlugin);
        else if (warn) console.warn('[tegaki] plugins: skipping an entry that is neither a plugin, a name nor [name, options]:', spec);
        continue;
      }
      const factory = factories.get(named.name);
      if (!factory) {
        missing.push(named.name);
        if (warn) warnMissing(named.name);
        continue;
      }
      // The same plugin named twice with the same options is two plugins (two glows).
      const base = `${named.name}\u0000${JSON.stringify(factory.changed(named.options))}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const key = `${base}\u0000${n}`;
      let plugin = this.made.get(key);
      if (!plugin || this.madeBy.get(plugin) !== factory) {
        plugin = factory(factory.resolve(named.options));
        this.madeBy.set(plugin, factory);
      }
      made.set(key, plugin);
      plugins.push(plugin);
    }
    this.made = made;
    return { plugins, missing };
  }
}

/** Names from `specs` that are among `names` — whether a registration concerns a list. */
export function namesAny(specs: readonly TegakiPluginSpec[], names: readonly string[]): boolean {
  return specs.some((spec) => {
    const named = namedSpec(spec);
    return named !== null && names.includes(named.name);
  });
}
