// Demo plugins for the studio's Plugins tab: what the renderer's plugin API
// (`TegakiPlugin`) can draw, written the way a user of `tegaki` would write
// them. They're for showing, not shipped — Export and the agent prompt leave
// them out.

import type { TegakiPlugin } from 'tegaki/core';
import { brushPlugin } from './brush.ts';
import { echoPlugin } from './echo.ts';
import { penPlugin } from './pen.ts';
import { soundPlugin } from './sound.ts';
import { strokeOrderPlugin } from './stroke-order.ts';

export interface ShowcasePlugin {
  id: string;
  label: string;
  /** What it does and which hooks it uses. */
  description: string;
  create: () => TegakiPlugin;
}

export const SHOWCASE_PLUGINS: readonly ShowcasePlugin[] = [
  {
    id: 'pen',
    label: 'Pen',
    description: 'A fountain pen writes the text, lifting between strokes. overlay + bounds.',
    create: penPlugin,
  },
  {
    id: 'order',
    label: 'Stroke order',
    description: 'Numbers and arrows beside each stroke, kept clear of the ink, over a faint tracing of the text. underlay + overlay.',
    create: strokeOrderPlugin,
  },
  {
    id: 'brush',
    label: 'Brush',
    description: 'A bristly ink brush whose hairs run dry toward the end of each stroke. paint.',
    create: brushPlugin,
  },
  {
    id: 'echo',
    label: 'Echo',
    description:
      'Three strokes over each path, one a beat behind the other. paint — turn Clip to text off (Style → Rendering) to see the passes around the ink, not just ahead of it.',
    create: echoPlugin,
  },
  {
    id: 'sound',
    label: 'Sound',
    description: 'A pencil scratch that follows the pen, and a tap as each stroke starts. onFrame.',
    create: soundPlugin,
  },
];

const IDS = new Set(SHOWCASE_PLUGINS.map((p) => p.id));

/** The known ids among `ids`, each once, in the order the plugins are listed (the order they run). */
export function normalizePluginIds(ids: readonly string[]): string[] {
  const on = new Set(ids.filter((id) => IDS.has(id)));
  return SHOWCASE_PLUGINS.filter((p) => on.has(p.id)).map((p) => p.id);
}

/** Fresh plugin instances for `ids` — create them once per change of the list, not per render: the engine re-lays the text when its plugins change. */
export function createShowcasePlugins(ids: readonly string[]): TegakiPlugin[] {
  const on = new Set(ids);
  return SHOWCASE_PLUGINS.filter((p) => on.has(p.id)).map((p) => p.create());
}
