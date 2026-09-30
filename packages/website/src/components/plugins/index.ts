// Demo plugins for the studio's Plugins tab: what the renderer's plugin API
// (`TegakiPlugin`, made with `createPlugin`) can draw, written the way a user
// of `tegaki` would write them. They're for showing, not shipped — Export and
// the agent prompt leave them out (but for its Plugin goal, which lists them).

import {
  annotatePlugin,
  boilPlugin,
  type TegakiPlugin,
  type TegakiPluginFactory,
  type TegakiPluginOptions,
  type TegakiPluginParams,
  variationPlugin,
} from 'tegaki/core';
import { REPO_URL } from '../../site.ts';
import { ballpointPlugin } from './ballpoint.ts';
import { bleedPlugin } from './bleed.ts';
import { brushPlugin } from './brush.ts';
import { burnPlugin } from './burn.ts';
import { captionPlugin } from './caption.ts';
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
import { ink3dPlugin } from './ink3d.ts';
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
import { textPathPlugin } from './text-path.ts';
import { typewriterPlugin } from './typewriter.ts';
import { wetPlugin } from './wet.ts';

export interface ShowcasePlugin {
  /** Its key in the URL (`pg`, `po`) — kept short, and stable across renames. */
  id: string;
  /** Makes it, and says what it can be set to (label, description, params, presets). */
  factory: TegakiPluginFactory;
  /** Its source on GitHub. */
  source: string;
  /** One of the few the Plugins tab lists first; the rest are under More. */
  featured?: boolean;
}

/** A demo plugin's source, from its file in components/plugins. */
const demo = (file: string) => `${REPO_URL}/blob/main/packages/website/src/components/plugins/${file}.ts`;
/** A plugin shipped in `tegaki/core`, from its file in the renderer's plugins. */
const core = (file: string) => `${REPO_URL}/blob/main/packages/renderer/src/plugins/${file}.ts`;

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
// and before the painters, so they paint the stretch it passes on; 3D ink
// last of the painters, since it keeps the colors the ones before it set and
// paints nothing flat for the ones after; in the ink hooks, the glows
// and grain before the shadow is cast, then the cathode tube over all of
// it, and the screen shake last, moving everything drawn before it.
export const SHOWCASE_PLUGINS: readonly ShowcasePlugin[] = [
  // Shipped in tegaki/core, not demos: Variation, Boil, Text on a path, Captions and Annotate.
  { id: 'vary', factory: variationPlugin, source: core('variation'), featured: true },
  { id: 'boil', factory: boilPlugin, source: core('boil'), featured: true },
  { id: 'slant', factory: slantPlugin, source: demo('slant') },
  { id: 'shaky', factory: shakyPlugin, source: demo('shaky') },
  { id: 'path', factory: textPathPlugin, source: demo('text-path'), featured: true },
  { id: 'nib', factory: nibPlugin, source: demo('nib') },
  { id: 'rhythm', factory: rhythmPlugin, source: demo('rhythm') },
  { id: 'joins', factory: joinsPlugin, source: demo('joins') },
  { id: 'caption', factory: captionPlugin, source: demo('caption') },
  { id: 'sweep', factory: sweepPlugin, source: demo('sweep') },
  { id: 'paper', factory: paperPlugin, source: demo('paper'), featured: true },
  { id: 'order', factory: strokeOrderPlugin, source: demo('stroke-order'), featured: true },
  { id: 'colors', factory: colorsPlugin, source: demo('colors'), featured: true },
  { id: 'type', factory: typewriterPlugin, source: demo('typewriter'), featured: true },
  { id: 'annotate', factory: annotatePlugin, source: core('annotate'), featured: true },
  { id: 'erase', factory: eraserPlugin, source: demo('eraser') },
  { id: 'segment', factory: segmentPlugin, source: demo('segment') },
  { id: 'ball', factory: ballpointPlugin, source: demo('ballpoint') },
  { id: 'graphite', factory: graphitePlugin, source: demo('graphite') },
  { id: 'wet', factory: wetPlugin, source: demo('wet'), featured: true },
  { id: 'marker', factory: markerPlugin, source: demo('marker') },
  { id: 'spray', factory: sprayPlugin, source: demo('spray') },
  { id: 'hatch', factory: hatchPlugin, source: demo('hatch') },
  { id: 'stitch', factory: stitchPlugin, source: demo('stitch') },
  { id: 'chalk', factory: chalkPlugin, source: demo('chalk') },
  { id: 'foil', factory: foilPlugin, source: demo('foil') },
  { id: 'burn', factory: burnPlugin, source: demo('burn') },
  { id: 'neon', factory: neonPlugin, source: demo('neon'), featured: true },
  { id: 'laser', factory: laserPlugin, source: demo('laser') },
  { id: 'brush', factory: brushPlugin, source: demo('brush'), featured: true },
  { id: 'echo', factory: echoPlugin, source: demo('echo') },
  { id: '3d', factory: ink3dPlugin, source: demo('ink3d') },
  { id: 'grain', factory: grainPlugin, source: demo('grain') },
  { id: 'bleed', factory: bleedPlugin, source: demo('bleed') },
  { id: 'shadow', factory: shadowPlugin, source: demo('shadow') },
  { id: 'crt', factory: crtPlugin, source: demo('crt') },
  { id: 'shake', factory: shakePlugin, source: demo('shake') },
  { id: 'sparkle', factory: sparklePlugin, source: demo('sparkle') },
  { id: 'karaoke', factory: karaokePlugin, source: demo('karaoke') },
  { id: 'pen', factory: penPlugin, source: demo('pen'), featured: true },
  { id: 'sound', factory: soundPlugin, source: demo('sound') },
  { id: 'haptics', factory: hapticsPlugin, source: demo('haptics') },
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
