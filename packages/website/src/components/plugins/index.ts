// Demo plugins for the studio's Plugins tab: what the renderer's plugin API
// (`TegakiPlugin`, made with `createPlugin`) can draw, written the way a user
// of `tegaki` would write them. They're for showing, not shipped — Export and
// the agent prompt leave them out.

import {
  annotatePlugin,
  boilPlugin,
  captionPlugin,
  type TegakiPlugin,
  type TegakiPluginFactory,
  type TegakiPluginOptions,
  type TegakiPluginParams,
  textPathPlugin,
  variationPlugin,
} from 'tegaki/core';
import { ballpointPlugin } from './ballpoint.ts';
import { bleedPlugin } from './bleed.ts';
import { brushPlugin } from './brush.ts';
import { burnPlugin } from './burn.ts';
import { chalkPlugin } from './chalk.ts';
import { colorsPlugin } from './colors.ts';
import { crtPlugin } from './crt.ts';
import { echoPlugin } from './echo.ts';
import { eraserPlugin } from './eraser.ts';
import { foilPlugin } from './foil.ts';
import { grainPlugin } from './grain.ts';
import { graphitePlugin } from './graphite.ts';
import { hapticsPlugin } from './haptics.ts';
import { hatchPlugin } from './hatch.ts';
import { joinsPlugin } from './joins.ts';
import { karaokePlugin } from './karaoke.ts';
import { laserPlugin } from './laser.ts';
import { markerPlugin } from './marker.ts';
import { neonPlugin } from './neon.ts';
import { nibPlugin } from './nib.ts';
import { paperPlugin } from './paper.ts';
import { penPlugin } from './pen.ts';
import { rhythmPlugin } from './rhythm.ts';
import { segmentPlugin } from './segment.ts';
import { shadowPlugin } from './shadow.ts';
import { shakePlugin } from './shake.ts';
import { shakyPlugin } from './shaky.ts';
import { slantPlugin } from './slant.ts';
import { soundPlugin } from './sound.ts';
import { sparklePlugin } from './sparkle.ts';
import { sprayPlugin } from './spray.ts';
import { stitchPlugin } from './stitch.ts';
import { strokeOrderPlugin } from './stroke-order.ts';
import { sweepPlugin } from './sweep.ts';
import { typewriterPlugin } from './typewriter.ts';
import { wetPlugin } from './wet.ts';

export interface ShowcasePlugin {
  /** Its key in the URL (`pg`, `po`) — kept short, and stable across renames. */
  id: string;
  /** Makes it, and says what it can be set to (label, description, params, presets). */
  factory: TegakiPluginFactory;
}

// Listed in the order they run, which is the order that matters: geometry
// first, so the painters get the reshaped strokes (a glyph leaned and shaken
// before it's laid on a path, the broad nib at the page's angle after); the
// timing hooks in the order they retime, a hand's pace before the joins make
// room between letters, the captions fit words to the voice, and a sweep or
// the typewriter replaces it all, then the annotations after the writing
// they mark, before the eraser rubs it all out; underlays bottom-most
// first, overlays top-most last; in the paint chain, whoever sets the color
// before whoever reads it (Colors, then Wet ink), Ballpoint's pieces before
// Wet ink times them, the painters that read the color (Marker, Spray,
// Hatching, Embroidery) and the ones that bring their own (Graphite, Chalk,
// Foil, Burn, Neon, Laser) after Colors, and the ones that decide what shows when
// (Typewriter, Eraser) ahead of the painters, and the Segment after them
// and before the painters, so they paint the stretch it passes on; in the ink hooks, the glows
// and grain before the shadow is cast, then the cathode tube over all of
// it, and the screen shake last, moving everything drawn before it.
export const SHOWCASE_PLUGINS: readonly ShowcasePlugin[] = [
  // Shipped in tegaki/core, not demos: Variation, Boil, Text on a path, Captions and Annotate.
  { id: 'vary', factory: variationPlugin },
  { id: 'boil', factory: boilPlugin },
  { id: 'slant', factory: slantPlugin },
  { id: 'shaky', factory: shakyPlugin },
  { id: 'path', factory: textPathPlugin },
  { id: 'nib', factory: nibPlugin },
  { id: 'rhythm', factory: rhythmPlugin },
  { id: 'joins', factory: joinsPlugin },
  { id: 'caption', factory: captionPlugin },
  { id: 'sweep', factory: sweepPlugin },
  { id: 'paper', factory: paperPlugin },
  { id: 'order', factory: strokeOrderPlugin },
  { id: 'colors', factory: colorsPlugin },
  { id: 'type', factory: typewriterPlugin },
  { id: 'annotate', factory: annotatePlugin },
  { id: 'erase', factory: eraserPlugin },
  { id: 'segment', factory: segmentPlugin },
  { id: 'ball', factory: ballpointPlugin },
  { id: 'graphite', factory: graphitePlugin },
  { id: 'wet', factory: wetPlugin },
  { id: 'marker', factory: markerPlugin },
  { id: 'spray', factory: sprayPlugin },
  { id: 'hatch', factory: hatchPlugin },
  { id: 'stitch', factory: stitchPlugin },
  { id: 'chalk', factory: chalkPlugin },
  { id: 'foil', factory: foilPlugin },
  { id: 'burn', factory: burnPlugin },
  { id: 'neon', factory: neonPlugin },
  { id: 'laser', factory: laserPlugin },
  { id: 'brush', factory: brushPlugin },
  { id: 'echo', factory: echoPlugin },
  { id: 'grain', factory: grainPlugin },
  { id: 'bleed', factory: bleedPlugin },
  { id: 'shadow', factory: shadowPlugin },
  { id: 'crt', factory: crtPlugin },
  { id: 'shake', factory: shakePlugin },
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
    const changed = plugin.factory.changed(options);
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
