# Tegaki

Monorepo for generating and rendering handwriting animations from any font.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode, ESNext, nodenext modules)
- **CLI framework**: [Padrone](https://github.com/KurtGokhan/padrone) - schema-first CLI with Zod v4
- **Font parsing**: opentype.js
- **Linter/Formatter**: Biome (2-space indent, single quotes, 140 line width)
- **Testing**: Bun's built-in test runner
- **Monorepo**: Bun workspaces

## Packages

- `packages/renderer` (`tegaki`) — Published npm package. Framework-agnostic animated handwriting renderer with adapters for React, Svelte, Vue, Nuxt, SolidJS, Astro, Web Components, vanilla JS, and Remotion. Ships pre-generated bundles under `tegaki/fonts/*`: Caveat, Italianno, Tangerine, Parisienne (Latin), Suez One (Hebrew), Amiri (Arabic), and Klee One (Japanese — kana + Kyōiku grade 1–2 kanji). Bundle generation is orchestrated by [packages/renderer/scripts/generate-fonts.ts](packages/renderer/scripts/generate-fonts.ts); per-script character sets are exported from `tegaki-generator` (`HEBREW_CHARS`, `ARABIC_CHARS`, `JAPANESE_CHARS`, `CHARSET_PRESETS` — see [packages/generator/src/charsets.ts](packages/generator/src/charsets.ts)).
- `packages/generator` (`tegaki-generator`) — Internal CLI + library that generates glyph data from fonts. Not published; users generate font data via the website UI (which calls the same pipeline in-browser).
- `packages/website` (`@tegaki/website`) — Astro + Starlight site containing the docs, framework examples, and the interactive generator/preview app at `/tegaki/generator/`.

## Commands

```bash
bun start          # Run the CLI (generator)
bun dev            # Watch mode (website)
bun run test       # Run tests (all packages)
bun typecheck      # TypeScript checks (all packages)
bun check          # Biome lint + format check
bun fix            # Biome auto-fix
bun checks         # All checks: lint + format + typecheck + tests
```

Use these commands instead of custom commands as much as possible. It's crucial that you don't use `bun run` when running these commands, as these are already whitelisted for agent use.

## Architecture

### Renderer (`packages/renderer`)

The `tegaki` npm package is a framework-agnostic renderer with a shared core engine and thin per-framework adapters. Each adapter is exposed as a subpath export (`tegaki/react`, `tegaki/svelte`, `tegaki/vue`, `tegaki/solid`, `tegaki/astro`, `tegaki/wc`). The bare `tegaki` entry re-exports the React adapter for ergonomic backwards compatibility.

```
packages/renderer/src/
  index.ts                    # Re-exports React adapter
  types.ts                    # Shared types: Point, TimedPoint, BBox, Stroke, TegakiBundle, TegakiEffects, etc.
  core/                       # Framework-agnostic engine
    engine.ts                 # TegakiEngine — timeline, playback, time control, bundle loading
    createBundle.ts           # Builds a TegakiBundle from parts
    bundle-registry.ts        # Global bundle registry (register/lookup by family name)
    render-elements.ts        # Low-level SVG element construction
    types.ts                  # Engine-level types (TimeControlProp, effect config, etc.)
  lib/                        # Shared helpers used by both core and adapters
    timeline.ts               # computeTimeline() — per-grapheme animation schedule
    textLayout.ts             # Line breaking, advance widths, RTL/LTR
    drawGlyph.ts              # Glyph -> SVG path drawing
    drawFallbackGlyph.ts      # Fallback when glyph missing from bundle
    effects.ts                # Glow, wobble, pressureWidth, taper, gradient
    strokeCache.ts            # Memoized stroke subdivision (CSS-pixel aware)
    css-properties.ts         # CSS custom property plumbing for animation state
    font.ts                   # FontFace registration helpers
    utils.ts
  react/TegakiRenderer.tsx    # React adapter
  svelte/                     # Svelte 5 adapter
  vue/                        # Vue 3 adapter
  solid/                      # SolidJS adapter
  astro/TegakiRenderer.astro  # Astro adapter (SSR-capable)
  wc/                         # Web Component adapter (`<tegaki-renderer>`)
  remotion/                   # Remotion-specific helpers
```

Pre-generated font bundles live outside `src/`, under `packages/renderer/fonts/<family>/` and are regenerated via `bun --filter tegaki generate-fonts`.

### Generator (`packages/generator`)

CLI entry point uses Padrone. The `generate` command orchestrates a pipeline that processes each glyph through several stages.

#### Pipeline (per glyph)

```
Font download -> Parse (opentype.js) -> Flatten beziers -> Rasterize -> Skeletonize -> Trace -> Compute width -> Order strokes -> JSON output
```

1. **Extract** (`src/font/parse.ts`): opentype.js extracts path commands and metrics
2. **Flatten** (`src/processing/bezier.ts`): Adaptive de Casteljau subdivision converts bezier curves to polyline segments
3. **Rasterize** (`src/processing/rasterize.ts`): Scanline fill with nonzero winding rule produces a binary bitmap
4. **Skeletonize** (`src/processing/skeletonize.ts`): Reduces the bitmap to a 1px-wide skeleton. Default is Zhang-Suen thinning; the pipeline also supports Guo-Hall, Lee 3D, morphological thin, medial-axis (distance transform ridge), and Voronoi-based medial axis (`voronoi-medial-axis.ts`).
5. **Trace** (`src/processing/trace.ts`): Walks skeleton pixels into polylines, prunes short spurs, simplifies with Ramer-Douglas-Peucker
6. **Width** (`src/processing/width.ts`): Distance transform computes stroke width (diameter) at each skeleton point
7. **Stroke order** (`src/processing/stroke-order.ts`): Groups polylines into connected components, sorts top-to-bottom/left-to-right, orients strokes, assigns `t` parameter (0-1 animation progress)

#### File Structure

```
packages/generator/src/
  index.ts                    # Public API exports (used by the website's in-browser pipeline)
  constants.ts                # Defaults: resolution (400), chars, font family (Caveat), tolerances
  cli/
    index.ts                  # CLI entry point (Padrone)
    index.test.ts             # Tests
  commands/
    generate.ts               # Generate command: orchestrates the full pipeline and writes the bundle
  font/
    download.ts               # Google Fonts download + local .ttf caching
    parse.ts                  # opentype.js wrapper
  processing/
    bezier.ts                 # Bezier curve flattening (adaptive de Casteljau subdivision)
    rasterize.ts              # Scanline fill rasterizer (nonzero winding rule)
    skeletonize.ts            # Zhang-Suen, Guo-Hall, Lee, morphological thin, medial axis
    voronoi-medial-axis.ts    # Voronoi-based medial axis alternative
    trace.ts                  # Skeleton pixel tracing + RDP simplification + spur pruning
    width.ts                  # Distance transform for stroke width
    stroke-order.ts           # Connected component grouping + heuristic ordering
    animated-svg.ts           # Convert strokes to animated SVG + TSX
    visualize.ts              # Debug visualization (bitmap, skeleton, traces)
    png.ts                    # PNG encoding
  debug/
    output.ts                 # Write debug visualization files
```

### Website (`packages/website`)

Astro 6 site built on Starlight (theme: Nova) serving the public docs at the root and the interactive generator at `/tegaki/generator/`. Starlight handles the sidebar/content docs under `src/content/docs/`; the generator page is a standalone Astro page mounting the React `GeneratorApp`.

```
packages/website/
  astro.config.ts             # Astro config — `base: '/tegaki'`, integrations (React, Svelte, Vue, Solid, Starlight), vite aliases (`tegaki@dev`)
  public/                     # Static assets served as-is (favicon, OG card, robots.txt)
  src/
    pages/generator.astro     # Mounts <GeneratorApp client:only="react" />
    components/
      GeneratorApp.tsx        # The generator UI: glyph inspector + text preview, all state persisted to URL
      url-state.ts            # URL <-> state serialization (short keys, only non-defaults written)
      LiveDemo.tsx            # Embeddable React demo used in docs
      HomePageExamples.tsx
      HomePageExamplesLoader.tsx
      StaticChatDemo.tsx
      astro/ solid/ svelte/ vanilla/ vue/ wc/   # Per-framework example components referenced from docs
    content/
      docs/                   # Starlight MDX/Markdown content
    content.config.ts         # Starlight content collections config
    assets/                   # Logo, images
    styles/global.css         # Tailwind v4 styles (imported via `@tailwindcss/vite`)
```

Dev server: `bun dev` → Astro at `http://localhost:4321/tegaki/`. Two preview routes share the same URL-state schema:

- `/tegaki/generator/` — the interactive UI (`GeneratorApp`): sidebar, controls, glyph inspector, text preview tab.
- `/tegaki/preview/` — a chrome-free standalone text renderer (`StandaloneTextPreview`) that reads the same URL state and renders only the text. Use this for screenshots / snapshots — no UI to crop out, and `window.__tegakiPreviewReady` / `body[data-tegaki-ready]` are set once the bundle is built so tooling can wait deterministically.

The Text Preview tab in the generator has an "open in new tab" icon button next to the textarea that opens the current state in `/preview` (just swaps `/generator` → `/preview` in the URL).

#### Testing the preview app via URL state

Both pages persist / read the same state via the short keys defined in [packages/website/src/components/url-state.ts](packages/website/src/components/url-state.ts) (only `GeneratorApp` writes; `/preview` is read-only). This is the primary way for an agent to drive rendering reproducibly — navigate to a URL, inspect the rendered output, change a param, repeat. Only values that differ from defaults are serialized, so unset params are equivalent to defaults.

Common keys (non-exhaustive — `url-state.ts` is the source of truth):

| Key  | Meaning                                                        | Example              |
|------|----------------------------------------------------------------|----------------------|
| `f`  | Font family (Google Fonts name)                                | `f=Caveat`           |
| `ch` | Character set being processed                                  | `ch=Abc`             |
| `g`  | Selected glyph (glyph mode)                                    | `g=A`                |
| `s`  | Active pipeline stage (`outline`/`skeleton`/`final`/...)       | `s=skeleton`         |
| `m`  | Preview mode: `glyph` or `text`                                | `m=text`             |
| `t`  | Preview text                                                   | `t=Hello`            |
| `tm` | Time mode: `controlled` / `uncontrolled` / `css`               | `tm=controlled`      |
| `ct` | **Paused timeline position in seconds (controlled mode).** When present and > 0, the text preview loads **paused** at that time. Auto-updated on pause/seek/reset, left stale during playback. | `ct=1.25` |
| `as` | Animation speed multiplier                                     | `as=2`               |
| `fs` | Font size in px                                                | `fs=96`              |
| `lh` | Line height ratio                                              | `lh=1.5`             |
| `ol` | Show debug overlay (0/1)                                       | `ol=1`               |
| `fx` | Effects state as JSON                                          | `fx=%7B...%7D`       |
| `se` / `ge` | Stroke / glyph easing preset                            | `se=ease-out-cubic`  |
| `pr` / `ss` | Render quality — pixel ratio / stroke segment size      | `pr=2&ss=1`          |

Pipeline options are also URL-addressable (`res`, `sk`, `bt`, `rt`, ... — see `OPTION_KEYS` in url-state.ts).

**Typical workflow for an agent inspecting a frame:**

1. Start the dev server (`bun dev`) if it isn't already running.
2. Navigate to a `/tegaki/preview/` URL encoding the desired state, e.g.
   `http://localhost:4321/tegaki/preview/?t=Hello&tm=controlled&ct=1.25&fs=96`
   Use `/preview` (not `/generator`) for visual testing — it has no chrome, so the rendered text fills the viewport and screenshots are easy to crop. Pass `w=…&h=…` to fix the container size in pixels (defaults to `100%`).
3. Take a screenshot / snapshot via whatever browser tooling is available (e.g. the `chrome-devtools` MCP — `new_page`, `navigate_page`, `take_screenshot`). The timeline will be **paused at `ct`**, so screenshots are deterministic. Wait for `body[data-tegaki-ready="true"]` (or `window.__tegakiPreviewReady`) before snapshotting so the font and bundle are guaranteed to be loaded.
4. To sweep frames, vary `ct` and re-navigate; the page does not hot-swap URL state, so a reload / re-navigation is required.
5. To capture the final frame, pass a `ct` value greater than the timeline duration — it clamps to the end and stays paused.

If you need to drive the interactive UI instead of taking a screenshot (e.g. flipping pipeline options through controls rather than URL params), use `/tegaki/generator/` with the same state keys.

Caveats:
- `ct` only applies in `tm=controlled`. In `uncontrolled` (engine-driven rAF) or `css` (scroll-timeline) modes the animation is not seekable by time; the param is ignored.
- When the agent changes the URL via `window.history.pushState` etc., state is *not* reparsed — `parseUrlState()` runs once on mount. Always use a full navigation/reload.
- `ct` is written when paused and stays stale during playback — copying a URL mid-playback will not capture the live time.

### Key Design Decisions

- **Pure TypeScript processing**: All image processing (rasterizer, Zhang-Suen, distance transform, RDP) is implemented from scratch to avoid native addon dependencies (no canvas, no sharp).
- **Coordinate system mismatch**: opentype.js `glyph.getPath()` outputs screen coordinates (y-down) while `glyph.getBoundingBox()` returns font coordinates (y-up). The pipeline computes bounding boxes from actual path points, not from opentype's bbox.
- **Spur pruning**: The Zhang-Suen skeleton produces noisy spur branches at thick stroke endpoints. These are pruned proportionally to bitmap size (8% of resolution, capped at 10px). If all polylines would be pruned (tiny glyphs like `.`), the longest one is kept.
- **Font caching**: Downloaded .ttf files are cached in `.cache/fonts/`. The Google Fonts CSS endpoint is fetched with a non-browser User-Agent to get .ttf URLs (not woff2).

### Output Format

The `generate` command writes a bundle directory containing three files:

```
<output>/
  <family>.ttf        # The raw font file, co-located so the bundle is self-contained
  glyphData.json      # Compact per-glyph stroke data (keys shortened for payload size)
  bundle.ts           # Auto-generated module: imports the font + JSON and exports a TegakiBundle
```

`glyphData.json` uses compact keys (decoded by the renderer as `TegakiGlyphData` — see [packages/renderer/src/types.ts](packages/renderer/src/types.ts)):

```json
{
  "A": {
    "w": 502,
    "t": 1.24,
    "s": [
      { "p": [[x, y, width], [x, y, width], ...], "d": 0, "a": 0.62 }
    ]
  }
}
```

- `w` — advance width (font units)
- `t` — total animation duration (seconds)
- `s` — strokes, each with:
  - `p` — points as `[x, y, width]` tuples (font units for coords, font units for stroke diameter)
  - `d` — delay before the stroke begins (seconds)
  - `a` — animation duration of the stroke (seconds)

The verbose in-memory shape (`FontOutput`/`GlyphData` with `boundingBox`, `path`, full `skeleton`, per-point `t`, etc.) is defined in `packages/renderer/src/types.ts` and is produced internally by the pipeline — only the compact projection above is persisted.

## Testing

Two layers:

- **Unit tests** (Bun's built-in runner): `*.test.ts` files alongside source. Import from `'bun:test'`, use `describe` / `test` / `expect`. Run with `bun run test` from the repo root.
- **Visual / e2e tests** (Playwright + committed screenshot snapshots): live in [packages/website/tests/e2e/*.e2e.ts](packages/website/tests/e2e). The `.e2e.ts` extension is intentional — `bun test` matches `*.spec.ts` / `*.test.ts`, so the e2e files stay out of the unit suite.

### Writing unit tests

Prefer the smallest layer that exercises the behaviour. If logic is buried inside a closure or hook, lift it out into a pure helper, export it, and test that — the way `splitForShaping` and `isShapingWhitespace` are exported from [packages/renderer/src/shaper-harfbuzz/index.ts](packages/renderer/src/shaper-harfbuzz/index.ts) so [the tests](packages/renderer/src/shaper-harfbuzz/index.test.ts) can drive them without spinning up wasm. Each `test` should pin one behaviour, with a name that reads as the rule it locks in (e.g. `'"s s" splits into word, space, word — preventing calt across the gap'`).

### Visual snapshot tests

The Playwright suite drives [/tegaki/preview/](packages/website/src/components/preview/StandaloneTextPreview.tsx) (the chrome-free standalone renderer) with URL params and snapshots the `[data-tegaki-container]` element. Snapshots live in `tests/e2e/text-preview.e2e.ts-snapshots/` and are committed per platform — `*-chromium-darwin.png` and `*-chromium-linux.png`. CI runs the linux files in the Playwright Ubuntu image, so any new case needs **both**.

`playwright.config.ts` sets `maxDiffPixelRatio: 0.02` to tolerate sub-pixel antialiasing drift, and `animations: 'disabled'` while snapshotting. The runner waits on `body[data-tegaki-ready="true"]` and `document.fonts.ready` before capturing, so frames are deterministic as long as `tm=controlled` + a fixed `ct` are passed.

To add a case:

1. Append a `PreviewCase` to the `CASES` array in [text-preview.e2e.ts](packages/website/tests/e2e/text-preview.e2e.ts) with deterministic params: `tm=controlled` + a fixed `ct` for a stable frame, `w` / `h` to fix the container size in pixels. Use `ol=1` and a mid-timeline `ct` when the case needs to lock in the canvas/overlay seam (both layers visible in one frame).
2. Generate the local darwin baseline: `cd packages/website && bun test:e2e:update`.
3. Generate the linux baseline (required for CI): `cd packages/website && bun test:e2e:docker:update`. Runs the same Playwright Ubuntu image CI uses — needs Docker. Without this CI will fail with "missing snapshot".
4. Eyeball the produced PNGs to confirm they capture the intended behaviour (don't just trust a passing test — a buggy fix can still snapshot cleanly). Commit both `-darwin` and `-linux` files alongside the test code change.
5. Verify with `bun test:e2e` (darwin) and `bun test:e2e:docker` (linux).

When in doubt, give the case a name that reads as the regression it guards against — `calt-not-across-space` over `ss-test`.

## Conventions

- Biome auto-formats on commit via husky + lint-staged
- Imports use `.ts` extensions for local imports (`import { foo } from './bar.ts'`), package imports use bare specifiers (`import { foo } from 'tegaki'`)
- Zod is imported as `import * as z from 'zod/v4'` (not default import)
- Cross-package imports use the package name: `tegaki` for renderer types/components, `tegaki-generator` for generator exports
