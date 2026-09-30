---
packages:
  tegaki: minor
---

## Plugins: reshape, retime and paint the handwriting

**Breaking:** the `effects` option is gone. Glow, taper, wobble and the gradients are now plugins, and pressure width is the new `pressure` option. See [Migrating from `effects`](#migrating-from-effects) below.

The new `plugins` option takes plugins that change how the handwriting is drawn. Every adapter accepts it as a prop, and `<tegaki-renderer>` as a property. A plugin is an object of optional hooks:

- `geometry` reshapes each stroke: it moves the stroke's points and changes their widths. It runs once per layout, not every frame. `outline` reshapes the glyph outlines the same way, so clip-to-text follows the ink.
- `timing` decides when each stroke starts and how long it takes. The engine's `duration`, `onComplete`, CSS time and `toSVG` all use the new times.
- `paint` paints one stroke, then passes it down the chain with `next`, so a plugin can recolor a stroke, paint it twice or skip it. It gets every stroke, including the ones the pen hasn't reached yet. `unclipped` is a layer that clip-to-text doesn't cut, for painting past the letters' edges, and `clipped` says whether clip-to-text is on.
- `ink` post-processes the finished ink: a glow, a shadow, a filter. `underlay` and `overlay` paint under and over it.
- `bounds` grows the canvas to hold whatever a plugin paints outside the ink.
- `steps` redraws the ink as a cycle of drawings, like the line boil of hand-drawn animation. `idle` keeps the cycle running after the text is written. `paintOnly` is for cycles that only change the painting, such as a flicker.
- `svg` adds defs, markup and per-stroke styles (a paint, or a color per draw progress) to `toSVG` / `exportSVG`. The exported file draws the ink as `geometry` shapes it and `timing` times it.
- `onFrame` runs after every render, for side effects such as sound.
- `attach` sets up what a plugin needs while it runs, such as a WebGL context or a library to load, and returns the function that releases it. `redraw()` draws the frame again once an asynchronous setup finishes.

Plugins run in the order they're listed. What a plugin paints depends only on the frame, so plugins behave the same in controlled time, while scrubbing and in CSS time.

`createPlugin` defines a plugin that takes options. The options are typed `params` (number, length, boolean, select, color, text and a list of colors), with defaults and ranges, plus named `presets`. `resolve()` and `changed()` handle options read from a URL or a file. A UI can build its controls from the params, and the studio's new Plugins tab does exactly that. `paintsDrawnOnly(factory)` marks a factory whose `paint` only restyles what the pen has drawn, like a color, so the renderer can skip the strokes still to come.

A `length` param is a size that can follow the text. A bare number is in its `unit`, em by default: a share of the font size, so it grows as the text does. A string names its own unit (`'8px'`, `'0.1em'`). `lengthToPx(length, fontSize)` turns one into pixels inside a hook, from the context's `fontSize`.

These plugins ship in `tegaki/core`:

- `glowPlugin` puts a soft light around the ink, sized in em so it grows with the text (`radius: 0.1`, or `'8px'` for a fixed size). With clip-to-text it lights the clipped letters as a whole. List it twice for two glows.
- `taperPlugin` thins each stroke toward its ends.
- `wobblePlugin` moves the ink by a wave or smooth noise, each glyph in its own phase. The clip-to-text outlines wobble with it.
- `strokeGradientPlugin` colors each stroke along its length: a rainbow, or a run through your colors.
- `globalGradientPlugin` lays one linear gradient across the whole text.
- `variationPlugin` makes every glyph a little different in size, slant, rotation, position, bend and ink width, so repeated letters don't look stamped. Clip-to-text follows it. It has Subtle, Loose and Signature presets.
- `boilPlugin` redraws the lines a few ways in turn, like hand-drawn or stop-motion animation. It can keep boiling after the text is written.

The new `pressure` option (0 to 1, default 1) sets how closely the ink's width follows the pen pressure the bundle records. At `0` each stroke is drawn at one width, its mean.

### Plugins by name

Register a plugin factory once, the way you register a font bundle, and then name it wherever only data can go:

```ts
TegakiEngine.registerPlugin(glowPlugin, taperPlugin);
```

```html
<tegaki-renderer font="Caveat" plugins="taper glow">Hello</tegaki-renderer>
<tegaki-renderer font="Caveat" plugins='["taper", ["glow", {"radius": 0.15}]]'>Hello</tegaki-renderer>
```

`plugins` accepts names (`'glow'`), names with options (`['glow', { radius: 0.15 }]`) and plugin objects, mixed freely. The options go through the factory's params, so the renderer keeps numbers in range and drops keys it doesn't know. A renderer keeps the plugins it made for the same names and options from one render to the next, and it picks up a name that is registered after the renderer starts. If a name is still unregistered once the page has loaded, the renderer warns.

- **Web component:** new `plugins` and `pressure` attributes. The `plugins` property, when set, takes precedence over the attribute.
- **Astro:** `<TegakiRenderer plugins={['taper', ['glow', { radius: 0.15 }]]} />` now works. The names are sent to the browser, so register the factories in a client script. A plugin object can't be sent, so it is left out, with a warning.
- **CLI:** `--plugins "taper glow"`, or a JSON array with options. Every `tegaki/core` plugin is available by name.
- **`textToSvg`:** takes `plugins`, as objects or registered names. An unknown name throws.

`registerPlugin`, `getPlugin` and `parsePluginSpecs` (which reads the attribute's format) are exported from `tegaki/core`, and `TegakiEngine.registerPlugin` / `TegakiEngine.getPlugin` are the same functions.

### Migrating from `effects`

| Before | After |
| --- | --- |
| `effects: { glow: { radius: 8, color: '#0cf' } }` | `plugins: [glowPlugin({ radius: '8px', color: '#0cf' })]`, or `radius: 0.1` (em) to grow with the text |
| `effects: { glow: { radius: '0.1em' } }` | `plugins: [glowPlugin({ radius: 0.1 })]` |
| `effects: { wobble: { amplitude: 2 } }` | `plugins: [wobblePlugin({ amplitude: 2 })]` |
| `effects: { taper: true }` | `plugins: [taperPlugin()]` |
| `effects: { strokeGradient: { colors: 'rainbow' } }` | `plugins: [strokeGradientPlugin()]` (no colors is the rainbow) |
| `effects: { globalGradient: { colors, angle } }` | `plugins: [globalGradientPlugin({ colors, angle })]` |
| `effects: { pressureWidth: false }` | `pressure: 0` |
| `effects: { pressureWidth: { strength: 0.5 } }` | `pressure: 0.5` |
| a second glow under a custom key | `glowPlugin(...)` listed twice |
| CLI `--effects '{"glow":{"radius":8}}'` | CLI `--plugins '[["glow", {"radius": "8px"}]]'` |
| `textToSvg(text, font, { effects })` | `textToSvg(text, font, { plugins })` |

The options and their units are unchanged, with two exceptions. A glow's sizes are lengths in em: `radius: 0.1` is a tenth of the font size, so the glow grows with the text, and `'8px'` keeps it at 8px. Its offsets, which were font units, are em too. And a stroke gradient's rainbow is an empty `colors` list instead of `'rainbow'`. The effects used to run in a fixed order; plugins run in the order you list them, and for paint the later plugin wins, so list a stroke gradient after a text gradient to have it show. Characters drawn from the fallback font are now plain text in the text's color. The canvas no longer glows, wobbles or tints them, except for a glow with clip-to-text, which lights the finished ink with them in it.

`resolveEffects`, `findEffect`, `findEffects`, `effectPlugins`, `TegakiEffects`, `TegakiEffectConfigs`, the effect-name types and `CSSLength` are removed.

`drawGlyph()` draws a single glyph through the same plugins, outside the engine. It now takes an options object (`drawGlyph(ctx, glyph, pos, time, { color, pressure, plugins, seed, … })`) in place of its fifteen positional arguments. For writing plugins, `tegaki/core` also exports:

- `StrokePath`: `pointAt`, `slice`, `bounds`, `map`, and a per-point `data` field that a `geometry` hook can fill for the hooks after it.
- The path helpers `offsetPath`, `inkEdge`, `clearance`, `unionBoxes` and `expandBox`.
- `paintStroke`, the default painter.
- `seededRandom`.
- `strokeInstances` and `sampleFrame`, which read the stroke timeline.

### Renders are the same on every load

The new `seed` option (the `seed` attribute on `<tegaki-renderer>`) sets where the renderer's random choices come from: what plugins draw with `random(key)` or shape by a glyph's `seed`, such as a wobble's phase. Before this, every load picked a new random seed, so a Remotion render split across tabs could jump between frames. The default is now `0`, so the same text draws the same way everywhere, which matches `textToSvg`. Pass `seed: 'random'` for a new look on each mount, and read `engine.seed` to get the number back so you can keep a result you like.
