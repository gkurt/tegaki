## tegaki@0.23.0

### Add a Simplified Chinese bundle: LXGW WenKai

`tegaki/fonts/lxgw-wenkai` draws the 1000 most frequent simplified Chinese characters (about 89% of running text), full-width Chinese punctuation and Latin. Stroke order follows the mainland convention from Make Me a Hanzi. The bundle ships only the generated subset, about 5 MB with its stroke data, not the 25 MB full font. Characters outside the set render without animation in the page's fallback font.

### Bundled fonts traced from the outline, with better stroke order

Every bundled font was regenerated with a new generator pipeline. Strokes are now traced from the font's outline geometry instead of a rasterized skeleton, so they follow the letter shapes more closely and leave less ink unpainted. Points of a V, pointed stroke ends and serif tips use the new nib stamps. The glyph sets and the bundle format are unchanged, but the animations look different: stroke paths, stroke counts and timings all changed.

Stroke order also improved:

- **Klee One:** kana and kanji follow KanjiVG stroke order wherever the strokes match. Strokes turn corners only where a brush would: 口 is drawn as the left side, then the top and right side in one stroke, then the closing bottom bar, instead of one loop.
- **Caveat, Italianno, Tangerine and Parisienne:** Latin letters follow Hershey reference order where they match.
- **Nanum Pen Script:** Hangul syllables follow standard jamo order: initial, then vowel, then final. That includes syllables whose jamo the font writes as a single stroke.
- **Amiri:** a stroke that stands on another is written after it, so ط and ظ draw the bowl before the stem.
- **Suez One:** Hebrew letters start at their top, so ה begins at its top-left corner instead of the foot of its right leg.
- **Shaped glyphs:** contextual alternates and other glyphs drawn through shaping keep the same stroke order as their plain copies.

### Smooth strokes with flat and square caps

With a `butt` or `square` line cap, strokes drawn with pressure width, taper or a stroke gradient came out fringed: those effects draw each short piece of a stroke separately, and every piece showed its own flat ends. The cap now applies only at the start and end of each stroke, and the pieces join round in between, the same as with round caps. SVG export gets the same fix.

### Choose the font for characters a bundle doesn't cover

The new `fallbackFont` option takes a CSS font-family list, such as `'"Noto Serif SC", serif'`. It sets the font for characters the bundle has no stroke data for, which appear without a handwriting animation. Every adapter accepts it, and on `<tegaki-renderer>` it is the `fallback-font` attribute.

Bundles that ship their full font now actually use it for those characters. Before, only the Astro adapter with `loadFont` registered the full font, so other adapters drew those characters in the browser's default font. The full font now downloads only once the text contains a character outside the bundle's set, so text inside the set never fetches it.

### Keep glow and wobble when strokes are clipped to the text

Clip-to-text masked everything drawn, effects included. A glow, which spreads past the letters, was cut away. A wobble moved the strokes, but the mask's edges stayed on the letters' outlines, so it never showed. Now the clipped ink glows after the clip, and the mask's outlines wobble in step with the strokes inside them. The canvas and SVG export both work this way, so the CLI's `--effects` glow no longer needs `--no-clip`.

### Draw a word's headline after its letters

Devanagari and Bengali are written letter by letter, then the headline (shirorekha) is drawn across the whole word. The timeline now supports more than one deferred stroke tier: each negative `priority` (compact `r`) is its own phase after the word's body strokes, highest first. Priorities between -1 and 0 are connecting tiers, drawn glyph to glyph with no gap so the pieces read as one line. The bundled Tillana and Atma fonts tag headlines with `-0.5`, so a word draws its letters, then its headline, then marks such as the anusvara (`-1`). Marks keep `-1`, so existing bundles animate as before, and `deferDots: false` still turns all deferral off.

### Lay out RTL and mixed-direction lines the way the browser does

A line containing any right-to-left character was treated as right-to-left and its words reversed. A line that opens with a Latin word, such as "Hi السلام", which `dir="auto"` lays out left to right, came out with "Hi" reversed and misplaced. Each word is now placed where the browser put it, so word order follows the browser's bidi and only the glyphs within a word follow the shaper.

The clip mask also always drew left to right from x = 0, which clipped away all but the leftmost word of a right-aligned RTL line. It now draws each word at its measured position, with the paragraph's direction and letter-spacing.

### Render elliptic nib stamps

Bundles can now describe ink that a round pen can't reach, such as the point of a V, a pointed stroke end or a serif tip. Each such spot is an elliptic stamp the pen leaves as it passes a point. A stroke lists its stamps in an optional `n` field, one `[pointIndex, dx, dy, major, minor, angle]` entry each (the `Nib` type). The canvas renderer and SVG export draw each stamp when the pen reaches its point. Stamps follow the stroke's wobble, taper, stroke scale and color. Strokes without stamps render exactly as before, and older renderers ignore the field, so existing bundles stay compatible in both directions.

### Fewer stray strokes drawn at the end of a character

Some ink runs past where the stroke-order reference ends a stroke, such as a stroke that starts just above the line it crosses. The bundled fonts used to draw that ink as a separate late stroke after the rest of the character. It is now drawn as part of its stroke. 79 Nanum Pen Script syllables changed, and many more now follow standard jamo order. Caveat's E and P and 14 Klee One characters also changed, along with a few Latin letters in Parisienne, Tangerine, Italianno, Suez One and Amiri.

### Handwriting animates even with reduced motion turned on

The renderer now animates by default when the visitor has turned on `prefers-reduced-motion`. Ink appearing in place isn't the kind of motion (parallax, zooming, sliding) that the setting guards against.

The new `reducedMotion` option chooses the behaviour. `'never'` (the default) always animates, `'user'` follows the OS setting, and `'always'` never animates. When the animation is skipped, the text is drawn finished and `onComplete` still fires. Every adapter accepts the option, and on `<tegaki-renderer>` it is the `reduced-motion` attribute. It only affects uncontrolled time.

This also fixes a bug: a page opened with reduced motion already on used to draw nothing, because the renderer stopped the animation at its first frame instead of showing the finished text.

### Stop drawing digits as numerators next to Arabic text

The fraction features `frac`, `numr` and `dnom` were enabled for the whole text like any other substitution feature, which turns every digit into a numerator. Amiri registers `numr` for Arabic, so the browser drew "123" beside Arabic as small numerators while the handwriting drew plain digits. These features are now left to the shaper, which applies them around a fraction slash on its own, as it already does for `init`, `medi` and `fina`.

### The CLI shapes text and matches the renderer's quality

`npx tegaki` now shapes text with harfbuzz, compiled to WASM and bundled into the CLI (nothing extra to install). Ligatures and contextual alternates, Arabic joining, Devanagari conjuncts and matras, and right-to-left and mixed-direction text are laid out the way the renderer lays them out. Before this, Hebrew and Arabic came out reversed and unjoined. `--no-shaping` restores the old advance-width layout.

Quality defaults now follow the studio:

- Strokes are clipped to the letter outlines, scaled ×1.2 first (`--clip <scale>`, `--no-clip`).
- Loop mode keeps variable stroke width (`--pressure 1`).

New flags:

- `--stroke-easing` / `--glyph-easing`, which take the studio's easing names.
- `--effects <json>` for glow, wobble, taper, and stroke and global gradients.
- `--letter-spacing` and `--seed`.

The CLI warns about characters the font has no strokes for, and `atma` (Bengali) is now available.

In the library:

- `textToSvg` takes `shaper`, `clipText`, `effects` and `seed`.
- `tegaki/shaper-harfbuzz` exports `createHarfbuzzShaper(bundle, fonts?)`, which builds a shaper from font bytes you already hold (for example read from disk in Node) instead of fetching them.

### Shape letter-spaced text the way the browser draws it

With letter-spacing set, browsers stop applying optional ligatures, and Chrome also drops contextual alternates. The overlay and clip mask then drew base letters while the shaper still picked their alternates, so the strokes didn't fit the mask (Caveat's d and o). Letter-spaced text is now shaped with `liga`, `clig`, `dlig`, `hlig` and `calt` turned off, and the overlay turns them off explicitly so every browser agrees. `BundleShaper.shape` takes a `letterSpaced` option for this, and the timeline is recomputed when the spacing changes to or from zero.

### Keep ink that reaches past a glyph inside the canvas

The canvas was the text box plus a fixed 0.2em margin, so ink reaching past a glyph's advance was cut off at the edge. One example is Caveat's d under negative letter-spacing, whose stem runs past the shortened advance. The canvas now grows each edge to fit the strokes' ink, including stroke width, clip-to-text scaling, glow and wobble. It sizes itself from every glyph in the text, drawn yet or not, so it holds still while the text animates.

### SVG export draws what the canvas draws

`TegakiEngine.toSVG()` now reproduces the canvas render instead of an approximation of it:

- **Timing** — the playback speed (new `speed` option, defaulting to the engine's uncontrolled `speed`), stroke and glyph easing, deferred dots and stagger's fixed durations. Each stroke's reveal follows its eased curve as cubic Bézier segments (SMIL `keySplines` / per-keyframe CSS timing functions); the default ease-out quad is one exact segment.
- **Effects** — taper, wobble, glow (as drop-shadow filters), `strokeGradient` and `globalGradient`, alongside pressure width and nib stamps. Loop mode now keeps variable width too.
- **Clip-to-text** — strokes are clipped to the text's glyph outlines, taken from the harfbuzz shaper (the new optional `BundleShaper.glyphPath`), so the font need not be embedded.
- **Fallback characters** — drawn as `<text>` in the fallback font, appearing when the canvas draws them.
- **Square and butt caps** draw dots square, as the canvas does.

New options: `loopHold` (seconds the finished text holds before a loop repeats) and `crop` — the viewBox now crops to the ink in every mode, not only in loop mode; pass `crop: false` for the full canvas box. The new async `exportSVG()` embeds the fonts an SVG's text still needs (clip-to-text without a shaper, fallback characters) as data URIs.

`textToSvg` and the CLI take `speed`, `loopHold` and `crop` (`--speed`, `--loop-hold`), follow the timing config's easings, and honour an explicit `pressure` in loop mode.

## tegaki@0.22.2

### Keep rendering when a bundle's font file fails to load

When a bundle's `.ttf` failed to load, the engine waited on the rejected promise forever. The canvas stayed blank, with only an unhandled `NetworkError` in the console. The usual trigger is Vite's dev pre-bundler (Vite ≤ 7): it moves the bundle into `node_modules/.vite/deps/`, which breaks the font's relative URL. The engine now logs one warning per font that names the fix (`optimizeDeps: { exclude: ['tegaki'] }`) and links to the bundler guide. It then keeps rendering the handwriting, using the fallback font's layout. A shaper whose promise rejects now falls back to unshaped rendering, so it can no longer stall playback.

## tegaki@0.22.1

### Ship the `tegaki/fonts/atma` build output

The Atma (Bengali) bundle was wired into the package `exports` map but never added to the renderer's `tsdown` build config, so `dist/fonts/atma/bundle.mjs` was missing from the published package and `import 'tegaki/fonts/atma'` failed to resolve. Registered the bundle in both the build `entry` map and the `.ttf` copy step so the compiled output ships alongside the other font bundles.

## tegaki@0.22.0

### Add Bengali support (Atma bundled font)

New `tegaki/fonts/atma` bundle covers Bengali, following the same pattern as the existing Devanagari (Tillana) and other non-Latin bundles.

## tegaki@0.21.0

### Infer and apply CSS `letter-spacing`

The renderer now reads `letter-spacing` from the container's computed style — alongside `font-size`, `line-height`, and `color` — and applies it to the animated strokes, re-measuring when it changes. Spacing is inserted between clusters in the shaper pen-walk (matching the browser exactly for Latin, CJK, and non-cursive RTL like Hebrew) and picked up automatically from the DOM-measured offsets on the char-keyed fallback path, so line wrapping, glyph positions, and the drawn text stay in sync. The headless `textToSvg` export gained a matching `letterSpacing` option.

### Fix the React `TegakiRenderer` ref handle on React 18

`TegakiRenderer` exposed its imperative handle via React 19's ref-as-prop, which React 18 silently drops (`ref is not a prop`), leaving the ref `null` despite the declared `react: >=18` support. It now uses `forwardRef`, so the `{ engine, element }` handle works on both React 18 and 19 (the generic component API is preserved).

### Fix doubled ghost text when exporting through DOM rasterizers

The DOM text overlay (kept for selection, accessibility and layout measurement) was hidden only with `-webkit-text-fill-color: transparent`. DOM-to-image/video rasterizers that don't implement that non-standard property — Editframe, html-to-image, Satori, headless-screenshot pipelines — repainted the overlay text in the inherited color and a default font, doubled on top of the canvas handwriting. It is now hidden with the standard `color: transparent`, which those exporters honor. (In `editable` mode the caret follows `currentColor`, so it is no longer independently visible — an accepted trade-off for correct exports.)

## tegaki@0.20.0

### Add `TegakiEngine.toSVG()` and a `canvas` accessor

The engine can now serialize its current text to a standalone SVG string via `toSVG({ animated, loop })` — either self-drawing (SMIL mask reveal, variable stroke width) or looping (CSS keyframes, constant width), with the viewBox cropped to the ink. The backing `<canvas>` is also exposed through a `canvas` getter so export tooling can read pixels without reaching through the DOM.

### Add a `tegaki` CLI and a `textToSvg()` export

`npx tegaki` renders text to an animated handwriting SVG straight from the command line. The same output is available programmatically through the new `textToSvg()` export, along with its `TextToSvgMode` and `TextToSvgOptions` types.

# tegaki

## 0.19.0

### Minor Changes

- 68ee58f: Support Korean (Hangul) writing system and add Nanum Pen Script as a built-in font. The bundle ships ~650 most-frequent precomposed Hangul syllables (KS X 1001 common band ∪ top-N Korean-Wikipedia-frequency, capped by the Google Fonts subsetting ceiling) plus the 40 modern compatibility jamo (19 consonants ㄱ–ㅎ + 21 vowels ㅏ–ㅣ) and the Latin baseline. Hangul is precomposed in Unicode, so no shaper is required.

### Patch Changes

- 29e111e: Fix Next.js App Router / Turbopack compatibility. Two build/packaging issues prevented `tegaki` from being used in a Next.js (App Router) app:

  - The bundler dropped the `'use client'` directive from the React adapter's output chunk, so importing `TegakiRenderer` into a Server Component failed with "You're importing a module that depends on `useState` into a React Server Component". The directive is now preserved in the built output.
  - The font subpath exports (`tegaki/fonts/*`) resolved the `node` condition to the raw TypeScript source, which uses `import ... with { type: 'url' }` import attributes that Turbopack/webpack can't process. The `node` condition now points to the pre-built `.mjs` bundle (which loads the font via `new URL('./font.ttf', import.meta.url)`), so it works in any Node-based bundler.

## 0.18.0

### Minor Changes

- b6e883b: Update Harfbuzz to v1.1.0
- d358cbd: Add `stagger` timing mode where each glyph starts a fixed advance (seconds or `"N%"` of the previous glyph's effective duration) after the previous one, with an optional static per-glyph duration that scales strokes to fit. Exposed in the website previewer via the new `st` / `sa` / `sd` URL keys.

### Patch Changes

- 150296e: Fix the Astro adapter so passing `font={bundle}` hydrates without an explicit `bundle` prop and lookups by human-friendly font name resolve correctly. Animations now also re-hydrate after Astro View Transitions navigations.
- 150296e: Make the Vue adapter's `effects` prop generic so custom effect configs are correctly type-inferred. Also drop a redundant Nuxt config type augmentation.

## 0.17.1

### Patch Changes

- affe5a5: Add shorthand for setting time property to a percentage for controlled progress mode.

## 0.17.0

### Minor Changes

- 2b4b435: Support Devanagari writing system and add Tillana as built-in font. Also fixed a bug with generating n-grams, which affected Arabic fonts.

### Patch Changes

- ee2db76: Fix GPOS and advance width features for some Arabic fonts like "Aref Ruqaa"

## 0.16.0

### Minor Changes

- 39e075e: Added support for font features and ligatures, RTL languages like Arabic and Hebrew, and text shaping with Harfbuzz. Three new built-in font bundles ship for non-Latin scripts: `tegaki/fonts/suez-one` (Hebrew), `tegaki/fonts/amiri` (Arabic), and `tegaki/fonts/klee-one` (Japanese — kana, JP punctuation, and Kyōiku grade 1–2 kanji).

## 0.15.0

### Minor Changes

- ecba479: Split `gradient` into `strokeGradient` + `globalGradient`, and add render-stage hooks for layout-spanning effects. Closes #26.

  **Breaking**

  The `gradient` effect is renamed to `strokeGradient` with unchanged behavior (each stroke independently maps its progress to the color stops; `colors: 'rainbow'` still works). Rename the key in your `effects` prop:

  ```tsx
  // before
  effects={{ gradient: { colors: ['#f00', '#00f'] } }}
  // after
  effects={{ strokeGradient: { colors: ['#f00', '#00f'] } }}
  ```

  **New — `globalGradient`**

  A canvas-space linear gradient that spans the full text bounding box — the leftmost pixel of the first glyph is `colors[0]` and the rightmost pixel of the last glyph is `colors[N]`, regardless of stroke boundaries. Matches CSS `background-clip: text` semantics.

  ```tsx
  effects={{
    globalGradient: {
      colors: ['#f00', '#00f'],
      angle: 0, // 0 = left→right (default); 90 = top→bottom; positive = clockwise
    },
  }}
  ```

  `strokeGradient` and `globalGradient` can be enabled independently. If both are on, `strokeGradient` wins per segment (its per-stroke color overrides `globalGradient`'s canvas-wide paint); this combination is unusual but predictable.

  **New — effect render-stage hooks**

  Effects can now declare optional `beforeRender(stage, config)` / `afterRender(stage, config)` hooks on their `EffectDefinition` metadata. The stage context exposes the 2D context, the `TextLayout`, a pre-computed `LayoutBBox`, base color, and seed. Hooks run once around the glyph loop (before in forward order, after in reverse), so effects spanning the whole layout — like `globalGradient` — have a natural place to set up canvas state. Built-in per-stroke effects (`glow`, `wobble`, `pressureWidth`, `taper`, `strokeGradient`) declare no hooks and are unaffected.

  **New public exports from `tegaki/core`**: `EffectDefinition`, `RenderStageContext`, `LayoutBBox`, `getEffectDefinition`, `hasRenderHooks`, `computeLayoutBbox`, plus the previously-private `findEffect` / `findEffects`.

## 0.14.0

### Minor Changes

- 79a0e6a: Add Nuxt module and usage example. Fixes [#35](https://github.com/KurtGokhan/tegaki/issues/35).
- 9a0d74a: Add `quality.smoothing` option that interpolates stroke points with a centripetal Catmull-Rom spline, hiding the faceted corners visible at large render sizes where the baked polyline resolution shows through. Enabling it forces subdivision on (default `segmentSize=2` CSS px) and rebuilds the subdivision cache; the original points stay on the curve, so animation timing and wobble phase are unchanged. Default is `false` (existing bundles render identically). Also exposed on the web component as the `smoothing` attribute.

### Patch Changes

- 84ad2b2: text layout was broken when element had transform applied
- b6967aa: canvas was not cleared when all text removed

## 0.13.0

### Minor Changes

- 8fd875a: Add `clipText` quality option that clips handwriting strokes to the filled text shape using canvas composite operations. Accepts `true` for clipping with normal stroke widths, or a number to scale stroke widths (e.g. `2` for 2x wider strokes that fill more of the glyph interior).

### Patch Changes

- 2a46c09: fix compatibility with old Safari versions, and a bug with text layout when text is wrapped. Fixes [#29](https://github.com/KurtGokhan/tegaki/issues/29)
- cdb2993: Fix timing around whitespace characters. Spaces and line breaks no longer consume `unknownDuration` on top of `wordGap`/`lineGap` — the gap alone now represents the full pause. `\r\n` and `\r` are normalized to `\n`, and all Unicode whitespace (NBSP, tab, ideographic space, etc.) is treated as a word gap.

  Fixes [#28](https://github.com/KurtGokhan/tegaki/issues/28)

## 0.12.0

### Minor Changes

- be16624: Add bundle format versioning. Generated bundles now include a `version` field (currently `0`) so the engine can detect incompatible bundles. The engine checks the version when a bundle is registered or resolved and logs a console warning (once per bundle) if the version is missing or unsupported.

  New exports: `BUNDLE_VERSION`, `COMPATIBLE_BUNDLE_VERSIONS`. New optional `TegakiBundle` field: `version`. Existing bundles without a version field trigger the warning but continue to work.

- 9776ca3: Cache stroke subdivision across glyph instances. Subdivision now depends
  only on (stroke points, fontSize, segmentSize) and is reused by every
  occurrence of the same glyph in the rendered text. Wobble, progress
  truncation, pressure, taper, and gradient are applied at draw time on
  top of the shared geometry, and effect config changes no longer
  invalidate the cache. Glow draws the full truncated polyline in a single
  stroke() call, removing the previous per-sub-segment shadowBlur cost.

  Wobble is now sampled per sub-vertex (fractional original-point index
  keeps phase continuous), giving smoother curves than the previous
  lerp-between-wobbled-raw-vertices.

- 1ce1324: Add subset font bundling with full-font fallback. Bundles generated from a character subset now ship two font files: a subsetted TTF for the generated glyphs and the full TTF as a CSS fallback. The subset font is registered under a scoped family name (`<family> Tegaki <hash>`) to avoid colliding with user-loaded fonts, while the full font uses the original family name. The renderer composes both in `font-family` so the browser automatically falls back to the full font for non-generated characters.

  New `TegakiBundle` fields: `fullFamily`, `fullFontUrl`. Existing bundles without these fields continue to work unchanged.

### Patch Changes

- 73a6b7e: Introduces TegakiQuality ({ pixelRatio, segmentSize }) on the engine
  options, replacing the top-level segmentSize. pixelRatio multiplies
  devicePixelRatio when sizing the canvas backing store and root
  transform, letting the browser downsample to the displayed size for
  higher-quality antialiasing at a quadratic cost in pixels filled.
  segmentSize retains its prior meaning under the new namespace.
- d9b7c85: feat: add stroke and glyph easing functions
- 7aaf5d2: add rtl direction support
- 23757ca: Breaking: `quality.segmentSize` is now measured in CSS pixels instead of
  font units. Subdivision count now scales with rendered size, so small
  glyphs are no longer over-subdivided. A 100px stroke with segmentSize=1
  yields ~100 sub-segments; the same stroke at 10px yields ~10.

## 0.11.1

### Patch Changes

- [`5e5049f`](https://github.com/KurtGokhan/tegaki/commit/5e5049ffc86a275fd2892fcb683d1e1ad702542e) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - use correct import path for node/ssr imports

## 0.11.0

### Minor Changes

- [`4b7db41`](https://github.com/KurtGokhan/tegaki/commit/4b7db41fb1c247ed766ff10284e9cdabd4ab0a25) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Implement new text layout based on DOM and text ranges

### Patch Changes

- [`f3602b0`](https://github.com/KurtGokhan/tegaki/commit/f3602b04970c8cb88ea41e87e63ee4709b086d61) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - improve line cap detection for CJK fonts

- [`28f58c6`](https://github.com/KurtGokhan/tegaki/commit/28f58c67f9eae8e0123a915d0efea03eaccd5e27) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - fixed a bug with generator that caused it to not load all characters in a font, especially CJK

- [`047e5e3`](https://github.com/KurtGokhan/tegaki/commit/047e5e31d3ffabbecf25dd36b5f56d298731c630) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add `duration` and `easing` options to uncontrolled time mode.

  - `duration` stretches or compresses one iteration to take exactly N seconds, derived from the natural timeline inside the engine. Mutually exclusive with `speed` / `catchUp` at the type level (discriminated union); when both are set at runtime, `duration` takes precedence.
  - `easing: (t: number) => number` maps linear progress (0–1) to displayed progress (0–1). Applied at read-time, so `currentTime`, `onTimeChange`, and the `--tegaki-time` / `--tegaki-progress` CSS custom properties all reflect the eased value. Completion is evaluated against linear progress so overshoot/undershoot curves (e.g. `easeOutBack`) don't trip completion early or late.
  - The web component adapter accepts a `duration` attribute; `easing` is available via the `time` JS property only (it's function-valued).

## 0.10.0

### Minor Changes

- [`7198553`](https://github.com/KurtGokhan/tegaki/commit/719855392734a8f1b6056db9f0718ac7a8213527) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add controlled progress mode to allow users to specify the exact progress of the animation that is a value between 0 and 1.

### Patch Changes

- [`b326f00`](https://github.com/KurtGokhan/tegaki/commit/b326f00d52b97ef19e0214cb4595bd31cd501cf4) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add delay and loop gap for uncontrolled animations

- [`1449890`](https://github.com/KurtGokhan/tegaki/commit/144989014c0d9cdbf80fafbb77af646b96065832) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add docs and example for using Tegaki with Remotion. The example is a simple composition that renders a single text prop, but the same principles apply to more complex compositions and dynamic props.

- [`1449890`](https://github.com/KurtGokhan/tegaki/commit/144989014c0d9cdbf80fafbb77af646b96065832) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Fix rendering when zoom level was not 100%.

## 0.9.0

### Minor Changes

- [#12](https://github.com/KurtGokhan/tegaki/pull/12) [`e43197f`](https://github.com/KurtGokhan/tegaki/commit/e43197f5719368bed5280aa106c8fcb7afe05b4e) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add CDN-friendly font bundles and `createBundle` helper

  - Built font bundles now use `new URL(..., import.meta.url)` instead of bundler-specific import attributes, making them work natively in browsers and on CDN services like esm.sh and jsDelivr
  - Glyph data JSON is inlined in the built output so no import attributes are needed at runtime
  - Added `createBundle()` to `tegaki/core` and `tegaki/wc` for manually assembling a font bundle from fetched glyph data and a font URL

## 0.8.0

### Minor Changes

- [`b0dabe4`](https://github.com/KurtGokhan/tegaki/commit/b0dabe4ede42564ca2fadf68a3db23a94c55d163) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Add Web Components adapter (`tegaki/wc`) with `<tegaki-renderer>` custom element and docs page.

### Patch Changes

- [`4068d1c`](https://github.com/KurtGokhan/tegaki/commit/4068d1c74413e302b73375897aa9377c215a087a) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Fix user-provided inline styles being overridden by engine root styles in Astro, Svelte, and Solid adapters.

## 0.7.0

### Minor Changes

- [`be540e1`](https://github.com/KurtGokhan/tegaki/commit/be540e13d47804b2068ee111f0297ef4809d6550) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Remove extra wrapper div from TegakiRenderer DOM output. The engine now uses the adapter's container element directly as its root (`data-tegaki="root"`), eliminating a redundant nested div. This fixes CSS-controlled animations where styles applied to the `<TegakiRenderer>` component (like `animation-timeline`) weren't reaching the engine's root element. `renderElements` now returns `{ rootProps, content }` instead of a single element tree.

## 0.6.0

### Minor Changes

- [`9288227`](https://github.com/KurtGokhan/tegaki/commit/9288227945a7623158990744809dc7d711536a7a) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Tegaki is framework agnostic now

## 0.5.0

### Minor Changes

- [`dc581bf`](https://github.com/KurtGokhan/tegaki/commit/dc581bf2e68324ba810c01aea3b7d5c646462a42) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Fix font bundle types and make sure they are assignable to the expected type.

## 0.4.0

### Minor Changes

- [`2236325`](https://github.com/KurtGokhan/tegaki/commit/2236325c7119b6de47be3f479b3e01b2cae4b907) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Rework font loading and improve defaults

  - **Breaking**: Remove `registerFontFace()` from `TegakiBundle`. Font registration is now handled internally by `TegakiRenderer` via the FontFace API.
  - Add `fontFaceCSS` property to `TegakiBundle` for SSR/stylesheet-based font loading.
  - Export `ensureFontFace()` utility for manually preloading a bundle's font.
  - Fix font layout being calculated with wrong font metrics when switching fonts or when the font isn't loaded yet.
  - Enable `pressureWidth` effect by default.
  - Handle non-JS environments (SSR) more gracefully.

## 0.3.1

### Patch Changes

- [`706375b`](https://github.com/KurtGokhan/tegaki/commit/706375bf056caefb8fd4c4279da9e0124535b706) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Accessibility, SSR and RSC fixes

## 0.3.0

### Minor Changes

- [`2295113`](https://github.com/KurtGokhan/tegaki/commit/2295113f02a0d67c398258846ba5576a5c162d96) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - - Reduced font bundle data size
  - Fix rerendering when color changes
  - Fix padding and border issue in renderer

## 0.2.3

### Patch Changes

- [`d171776`](https://github.com/KurtGokhan/tegaki/commit/d171776e48eae2063246209e8b56bf9e9185f4c7) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Fix layout issues when font is being loaded. Fix layout being calculated with ligatures.

## 0.2.2

### Patch Changes

- [`4f5c639`](https://github.com/KurtGokhan/tegaki/commit/4f5c639799056093a8797dbb6a84cd6989500811) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - changeset fix

## 0.2.1

### Patch Changes

- [`1b079f5`](https://github.com/KurtGokhan/tegaki/commit/1b079f5dd6cb174b9b272c5e217dd1df1e5c0b12) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - initial release

## 0.2.0

### Minor Changes

- [`273bd36`](https://github.com/KurtGokhan/tegaki/commit/273bd36ece40ad3629aad2f62d3bcf3849a59cf0) Thanks [@KurtGokhan](https://github.com/KurtGokhan)! - Beta release of Tegaki, a handwriting animation library for JavaScript and React. This release includes basic support for rendering handwriting animations, as well as a browser based animation generator. Future updates will focus on improving stroke orders for better natural handwriting estimation. We welcome feedback and contributions from the community to help make Tegaki even better!
