// Demo plugins for the studio's Plugins tab: what the renderer's plugin API
// (`TegakiPlugin`, made with `createPlugin`) can draw, written the way a user
// of `tegaki` would write them. They're for showing, not shipped — Export and
// the agent prompt leave them out.

import {
  boilPlugin,
  changedPluginOptions,
  type TegakiPlugin,
  type TegakiPluginFactory,
  type TegakiPluginOptions,
  type TegakiPluginParams,
  variationPlugin,
} from 'tegaki/core';
import { ballpointPlugin } from './ballpoint.ts';
import { bleedPlugin } from './bleed.ts';
import { brushPlugin } from './brush.ts';
import { colorsPlugin } from './colors.ts';
import { echoPlugin } from './echo.ts';
import { grainPlugin } from './grain.ts';
import { graphitePlugin } from './graphite.ts';
import { hapticsPlugin } from './haptics.ts';
import { karaokePlugin } from './karaoke.ts';
import { laserPlugin } from './laser.ts';
import { neonPlugin } from './neon.ts';
import { nibPlugin } from './nib.ts';
import { paperPlugin } from './paper.ts';
import { penPlugin } from './pen.ts';
import { shadowPlugin } from './shadow.ts';
import { shakyPlugin } from './shaky.ts';
import { slantPlugin } from './slant.ts';
import { soundPlugin } from './sound.ts';
import { sparklePlugin } from './sparkle.ts';
import { strokeOrderPlugin } from './stroke-order.ts';
import { wetPlugin } from './wet.ts';

export interface ShowcasePlugin {
  /** Its key in the URL (`pg`, `po`) — kept short, and stable across renames. */
  id: string;
  /** Makes it, and says what it can be set to (label, description, params, presets). */
  factory: TegakiPluginFactory;
}

// Listed in the order they run, which is the order that matters: geometry
// first, so the painters get the reshaped strokes; underlays bottom-most
// first, overlays top-most last; in the paint chain, whoever sets the color
// before whoever reads it (Colors, then Wet ink), Ballpoint's pieces before
// Wet ink times them, and the painters that bring their own color (Graphite,
// Neon, Laser) after Colors; in the ink hooks, the glows and grain before
// the shadow is cast.
export const SHOWCASE_PLUGINS: readonly ShowcasePlugin[] = [
  // Shipped in tegaki/core, not demos.
  { id: 'vary', factory: variationPlugin },
  { id: 'boil', factory: boilPlugin },
  { id: 'slant', factory: slantPlugin },
  { id: 'shaky', factory: shakyPlugin },
  { id: 'nib', factory: nibPlugin },
  { id: 'paper', factory: paperPlugin },
  { id: 'order', factory: strokeOrderPlugin },
  { id: 'colors', factory: colorsPlugin },
  { id: 'ball', factory: ballpointPlugin },
  { id: 'graphite', factory: graphitePlugin },
  { id: 'wet', factory: wetPlugin },
  { id: 'neon', factory: neonPlugin },
  { id: 'laser', factory: laserPlugin },
  { id: 'brush', factory: brushPlugin },
  { id: 'echo', factory: echoPlugin },
  { id: 'grain', factory: grainPlugin },
  { id: 'bleed', factory: bleedPlugin },
  { id: 'shadow', factory: shadowPlugin },
  { id: 'sparkle', factory: sparklePlugin },
  { id: 'karaoke', factory: karaokePlugin },
  { id: 'pen', factory: penPlugin },
  { id: 'sound', factory: soundPlugin },
  { id: 'haptics', factory: hapticsPlugin },
];

/** Some of a plugin's options, by param key. */
export type PluginOptions = Partial<TegakiPluginOptions<TegakiPluginParams>>;

/** Each plugin's options that differ from its defaults, by plugin id. */
export type PluginOptionsState = Record<string, PluginOptions>;

const BY_ID = new Map(SHOWCASE_PLUGINS.map((p) => [p.id, p]));

/** The known ids among `ids`, each once, in the order the plugins are listed (the order they run). */
export function normalizePluginIds(ids: readonly string[]): string[] {
  const on = new Set(ids.filter((id) => BY_ID.has(id)));
  return SHOWCASE_PLUGINS.filter((p) => on.has(p.id)).map((p) => p.id);
}

/**
 * `input` (read from a URL, say) as options state: known plugins only, each
 * with the options that differ from its defaults, as its params take them —
 * unknown keys and values a param can't take dropped, numbers kept in range.
 * Plugins left with nothing changed are left out.
 */
export function normalizePluginOptions(input: unknown): PluginOptionsState {
  const out: PluginOptionsState = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, options] of Object.entries(input)) {
    const plugin = BY_ID.get(id);
    if (!plugin || !options || typeof options !== 'object') continue;
    const changed = changedPluginOptions(plugin.factory.params, options);
    if (Object.keys(changed).length > 0) out[id] = changed;
  }
  return out;
}

/** The options state of just the plugins in `ids` — what's worth writing to a URL. */
export function pluginOptionsFor(ids: readonly string[], options: PluginOptionsState): PluginOptionsState {
  const out: PluginOptionsState = {};
  for (const id of ids) if (options[id]) out[id] = options[id];
  return out;
}

/**
 * Fresh plugin instances for `ids`, each with its options — create them once
 * per change of the list or its options, not per render: the engine re-lays
 * the text when its plugins change.
 */
export function createShowcasePlugins(ids: readonly string[], options: PluginOptionsState = {}): TegakiPlugin[] {
  const on = new Set(ids);
  return SHOWCASE_PLUGINS.filter((p) => on.has(p.id)).map((p) => p.factory(options[p.id]));
}
