# tegaki

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
