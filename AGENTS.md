# Tegaki

Monorepo for generating and rendering handwriting animations from any font.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode, ESNext, nodenext modules)
- **CLI framework**: [Padrone](https://github.com/gkurt/padrone) - schema-first CLI with Zod v4
- **Font parsing**: opentype.js
- **Linter/Formatter**: Biome (2-space indent, single quotes, 140 line width)
- **Testing**: Bun's built-in test runner
- **Monorepo**: Bun workspaces

## Packages

- `packages/renderer` (`tegaki`) — Published npm package. Framework-agnostic animated handwriting renderer with adapters for React, Svelte, Vue, Nuxt, SolidJS, Astro, Web Components, vanilla JS, and Remotion. Ships pre-generated bundles under `tegaki/fonts/*`: Caveat, Italianno, Tangerine, Parisienne (Latin), Suez One (Hebrew), Amiri (Arabic), Tillana (Devanagari), Klee One (Japanese — kana + Kyōiku grade 1–2 kanji), Nanum Pen Script (Korean), Atma (Bengali), and LXGW WenKai (Simplified Chinese — the 1000 most frequent hanzi; read from its GitHub release with `--font-file`, since Google Fonts carries only the Taiwan-form TC variant). Bundle generation is orchestrated by [packages/renderer/scripts/generate-fonts.ts](packages/renderer/scripts/generate-fonts.ts); per-script character sets are exported from `tegaki-generator` (`HEBREW_CHARS`, `ARABIC_CHARS`, `DEVANAGARI_CHARS`, `BENGALI_CHARS`, `JAPANESE_CHARS`, `KOREAN_CHARS`, `SIMPLIFIED_CHINESE_CHARS`, `CHARSET_PRESETS` — see [packages/generator/src/charsets.ts](packages/generator/src/charsets.ts)).
- `packages/generator` (`tegaki-generator`) — Internal CLI + library that generates glyph data from fonts. Not published; users generate font data via the website UI (which calls the same pipeline in-browser).
- `packages/website` (`@tegaki/website`) — Astro + Starlight site containing the docs, framework examples, and the interactive studio/preview app at `/tegaki/studio/`.

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
    engine.ts                 # TegakiEngine — timeline, playback, time control, bundle loading, frameAt(), and the render: every stroke through the plugins (types in core/types.ts)
    plugins.ts                # Runs a plugin list's hooks as one: geometry in sequence, paint as a chain of next() ending in paintStroke
    effectPlugins.ts          # The built-in effects as plugins (pressureWidth/taper/wobble = geometry, gradients = paint, glow = paint per stroke, or ink with clip-to-text — only over the ink's box, downsampled); run ahead of the user's
    drawGlyph.ts              # drawGlyph() — one glyph through the same plugins, for use outside the engine
    createBundle.ts           # Builds a TegakiBundle from parts
    bundle-registry.ts        # Global bundle registry (register/lookup by family name)
    render-elements.ts        # Low-level SVG element construction
    types.ts                  # Engine-level types (TimeControlProp, effect config, etc.)
  lib/                        # Shared helpers used by both core and adapters
    timeline.ts               # computeTimeline() — per-grapheme animation schedule
    strokeTimeline.ts         # The timeline per stroke: strokeInstances(), the one stroke clock (the canvas, svgExport and frameAt all read it), placeStrokes() — each stroke's rawPath reshaped by the plugins' geometry into its ink, a StrokePath in text-box px — and sampleFrame(), the pen head per stroke
    strokePath.ts             # StrokePath (pointAt / slice / bounds / map) and the geometry helpers plugins use: offsetPath, inkEdge, clearance, unionBoxes, expandBox
    paintStroke.ts            # paintStroke() — the default painter: a placed stroke's path up to its progress, then its nib stamps
    random.ts                 # seededRandom(seed, key) — deterministic per-key randomness (plugins' `random`)
    textLayout.ts             # Line breaking, advance widths, RTL/LTR
    drawFallbackGlyph.ts      # Fallback when glyph missing from bundle
    effects.ts                # resolveEffects() — the `effects` option as a sorted list; globalGradient geometry
    strokeEffects.ts          # The per-stroke effect math (wobble, taper, gradient colors, glow passes) the effect plugins and svgExport share
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

CLI entry point uses Padrone. The `generate` command orchestrates a pipeline that processes each glyph through several stages. `--pipeline` picks the stroke extraction: `geometry` (default — outline-geometry ink-graph extraction in `src/geometry/`, ordered by KanjiVG / Make Me a Hanzi / Hershey / Hangul references; the shipped bundles use it) or `raster` (below). Han characters follow one national convention per bundle, set by `--han-locale`: `ja` (default — KanjiVG first) or `zh` (Make Me a Hanzi, PRC order, first); the other dataset only fills characters the first lacks (`createReferenceSet` in [providers.ts](packages/generator/src/stroke-order/providers.ts)). A ligature has no reference of its own, so an LTR one is drawn letter by letter: its components' advances, laid end to end, mark each letter's slot, every stroke joins the letter holding its ink's midpoint, and each letter is ordered by its own references registered onto its own ink (`ligatureComponentEdges` / `componentSlots` in [ordering.ts](packages/generator/src/geometry/ordering.ts); RTL, headline-script and fraction ligatures keep the heuristic order). `--font-file <path.ttf|otf>` reads a local font instead of Google Fonts (all three commands below take it): the font is subset to the requested characters with hb-subset ([font/subset.ts](packages/generator/src/font/subset.ts)), the bundle takes the font's own family name, and the whole file is bundled as the fallback font (as `<family-slug>.ttf`, like the Google full downloads) only with `--full-font` — CJK fonts are tens of MB whole. Every `GeometryOptions` field is a flag too (`--extraction`, `--stroke-order`, `--ink-spur-tolerance`, …; defaults from `DEFAULT_GEOMETRY_OPTIONS`), and `--debug` writes each glyph's pipeline stages (SVG/PNG, plus the geometry warnings) under `<output>/debug/<glyph>/`.

Two scoreboard commands measure the pipeline over a character set — run them before and after a change and compare the summaries:

- `bun start coverage-report <Family> [-c chars] [-t tolerance] [--<geometry flag> …] [-j report.json]` — share of each glyph's rasterized ink no stroke pen or nib paints, geometry vs raster, with the worst offenders. The tolerance is in font units (default 2) so dots and letters are judged alike ([coverage-report.ts](packages/generator/src/commands/coverage-report.ts)).
- `bun start stroke-order-report <Family> [-c chars] [--han-locale ja|zh] [-j report.json]` — stroke-order agreement with the references (KanjiVG or Make Me a Hanzi, Hershey, and Hangul jamo templates): how many glyphs match 1:1 and take the dataset order, and how many are only *reference-guided* — Han, kana and Hangul strokes the font merges, ordered by where their ink runs along the reference ([stroke-order-report.ts](packages/generator/src/commands/stroke-order-report.ts), [guide.ts](packages/generator/src/stroke-order/guide.ts)).

#### Raster pipeline (per glyph)

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

Astro 6 site built on Starlight (theme: Nova) serving the docs, the interactive studio at `/tegaki/studio/`, and a standalone landing page at `/tegaki/`. Starlight handles the sidebar/content docs under `src/content/docs/`; the home and studio pages are standalone Astro pages outside Starlight. The home page ([index.astro](packages/website/src/pages/index.astro)) is static Astro markup with React islands from `components/home/`, each writing its own showpiece with the shipped bundles (lazy-loaded as they near the viewport; the CJK bundles are several MB) — keep its sample strings inside each bundle's character set. (The tool was renamed `/generator` → `/studio`; `/tegaki/generator/` remains as a redirect so old links keep working.)

```
packages/website/
  astro.config.ts             # Astro config — `base: '/tegaki'`, integrations (React, Svelte, Vue, Solid, Starlight), vite aliases (`tegaki@dev`)
  public/                     # Static assets served as-is (favicon, OG card, robots.txt)
  src/
    pages/index.astro         # Landing page: static sections + React islands from components/home/; shares Starlight's stored theme
    pages/studio.astro        # Mounts <Studio client:only="react" />; seeds <html data-theme> from Starlight's stored theme
    pages/generator.astro     # Redirect shim → /studio/ (kept for old links)
    components/
      studio/                 # The studio UI (editor layout: top bar, canvas, inspector), all state persisted to URL
        Studio.tsx            # Root: settings state (useStudioSettings), font loading, top bar, responsive layout
        TextWorkspace.tsx     # Text preview: text field, renderer canvas, transport / playback
        GlyphWorkspace.tsx    # Glyph inspector: glyph list, stage tabs, zoomable stage, per-glyph pipeline runs
        inspector/            # Properties panel — Style / Motion / Plugins / Pipeline tabs built from DialKit controls
        FontPicker.tsx ExportMenu.tsx Transport.tsx ZoomStage.tsx ui.tsx icons.tsx state.ts
      preview/                # Shared by /studio and /preview: TegakiTextPreview, stage views, export, constants
      plugins/                # Demo TegakiPlugins for the studio's Plugins tab (pen, stroke order, brush, echo, sound)
      url-state.ts            # URL <-> state serialization (short keys, only non-defaults written)
      home/                   # Landing-page islands: Hero + Greetings, ControlledTime (scroll-linked `time="css"` + slider), Scripts, Styles, TypeIt (editable), ChatStream, Write, Finale; shared.ts (font loading, useInView, useTheme)
      LiveDemo.tsx            # Embeddable React demo used in docs
      astro/ solid/ svelte/ vanilla/ vue/ wc/   # Per-framework example components referenced from docs
    content/
      docs/                   # Starlight MDX/Markdown content
    content.config.ts         # Starlight content collections config
    assets/                   # Logo, images
    styles/global.css         # Tailwind v4 styles (imported via `@tailwindcss/vite`)
    styles/home.css           # Landing-page styles (paper/ink palette, light + dark)
    styles/studio.css         # Studio-only styles (canvas backdrop, scrubber, DialKit tuning) on top of global.css
```

Dev server: `bun dev` → Astro at `http://localhost:4321/tegaki/`. Two preview routes share the same URL-state schema:

- `/tegaki/studio/` — the interactive UI (`Studio`): Text / Glyphs modes, font picker + Export in the top bar, and an inspector (Style / Motion / Pipeline) docked right on desktop, a bottom sheet below 1024px. Controls are [DialKit](https://github.com/joshpuckett/dialkit) components (`Slider`, `Toggle`, `SelectControl`, …) inside a themed `DialScope` ([dial.tsx](packages/website/src/components/studio/inspector/dial.tsx)); light/dark follows the docs' theme.

Glyphs mode inspects one character through the pipeline stages; the last stage, **Final**, is the real renderer (`TegakiTextPreview`) drawing the glyph with the Style / Motion settings. The glyph list's header picks the character set: `charsetCoverage` / `recommendCharset` ([charsets.ts](packages/website/src/components/studio/charsets.ts)) star the preset that fits the font, and picking a font in the studio adopts that preset when the current set is an unedited preset (a font restored from the URL keeps its `ch`).

A character can be drawn with more than one glyph — contextual alternates (Caveat swaps in `a.ss01` / `a.ss02` for a repeated letter), ligatures, Arabic positional forms. The **Forms** strip above the stage lists them for the selected character, from the font's GSUB table (`buildGsubGraph` / `glyphFormsOf` in [glyph-forms.ts](packages/generator/src/font/glyph-forms.ts), per font subset), each tagged with the feature that brings it in. `findFormExamples` shapes candidate texts with harfbuzz (the renderer's features) to find one that really draws each form; picking a form runs every stage on that glyph, and Final draws it in that text, outlined. Forms no text brings up (a feature switched off, or `init`/`fina` on Latin, which harfbuzz never applies) are dimmed with the reason. The glyph list badges characters that have forms; the selected form is the `gv` param ([GlyphForms.tsx](packages/website/src/components/studio/GlyphForms.tsx)).

Text mode draws a dashed frame around the rendered text: drag its right edge (Shift snaps to 10px, arrow keys on the handle step it), pick a width preset or type one from the width label, and Reset / double-click the handle to go back to Auto. The width is the `w` param, so `/preview` and the agent prompt wrap the text the same way ([TextFrame.tsx](packages/website/src/components/studio/TextFrame.tsx)). Hovering a character outlines it and clicking selects it; the selected character's ↗ button opens it in Glyphs mode, adding it to the character set if it's missing. The picker reads the renderer's timeline for the glyph it drew there ([glyph-cluster.ts](packages/website/src/components/studio/glyph-cluster.ts)): a ligature is outlined and picked as one, and when the glyph is one of the character's forms the button names it (`a.ss02 · calt`, `ffi ligature`) and opens that form. Character boxes are measured from the renderer's DOM text layer (`[data-tegaki="overlay"]`) with Ranges ([GlyphPicker.tsx](packages/website/src/components/studio/GlyphPicker.tsx), [glyph-hit.ts](packages/website/src/components/studio/glyph-hit.ts)).

"Ask an agent" (next to Export; in the ⋯ menu on phones) copies a Markdown prompt for a coding agent — goal (generate / optimize / fix), the font, charset, non-default settings as CLI flags, the inspected glyph's warnings, and studio + `/preview` links to iterate on. It's built by the pure `buildAgentPrompt` in [agent-prompt.ts](packages/website/src/components/studio/agent-prompt.ts); keep its iteration tips in step with this file.

The inspector's **Plugins** tab (Text mode) switches on demo plugins that show off the renderer's `TegakiPlugin` API, written the way a user of `tegaki` would: a fountain pen at the pen head (overlay), stroke-order numbers and arrows kept clear of the ink (underlay + overlay), a bristly brush (paint), echo passes over each stroke (paint), and a pencil scratch sound (onFrame). They live in [components/plugins/](packages/website/src/components/plugins) and are only for showing: the `pg` param carries them to `/preview`, but Export and Ask an agent leave them out.
- `/tegaki/preview/` — a chrome-free standalone text renderer (`StandaloneTextPreview`) that reads the same URL state and renders only the text. Use this for screenshots / snapshots — no UI to crop out, and `window.__tegakiPreviewReady` / `body[data-tegaki-ready]` are set once the bundle is built so tooling can wait deterministically.

The studio's Text mode has an "open in new tab" icon button next to the text field that opens the current state in `/preview` (just swaps `/studio` → `/preview` in the URL).

#### Testing the preview app via URL state

Both pages persist / read the same state via the short keys defined in [packages/website/src/components/url-state.ts](packages/website/src/components/url-state.ts) (only `Studio` writes; `/preview` is read-only). This is the primary way for an agent to drive rendering reproducibly — navigate to a URL, inspect the rendered output, change a param, repeat. Only values that differ from defaults are serialized, so unset params are equivalent to defaults.

Common keys (non-exhaustive — `url-state.ts` is the source of truth):

| Key  | Meaning                                                        | Example              |
|------|----------------------------------------------------------------|----------------------|
| `f`  | Font family (Google Fonts name)                                | `f=Caveat`           |
| `cs` / `ch` / `cr` | Character set. A preset is written by name (`cs=korean`, `cs=all` = every glyph in the font); an edited preset as the difference — `ch` appended characters, `cr` removed ones. A set that doesn't reduce to a preset exactly is a raw `ch` (as older URLs are) | `cs=latin&ch=€£` |
| `pl` | Stroke pipeline: `geometry` (default, ink-graph extraction) or `raster`. Also picks the Clip to text default (×1.2 for geometry, off for raster; `ct_=0` turns it off) and the pipeline Download Bundle uses | `pl=raster` |
| `g`  | Selected glyph (glyph mode)                                    | `g=A`                |
| `gv` | Selected form of that glyph — its glyph id (`<subset>:<gid>` in an extra font subset); unset = the default glyph | `gv=199` |
| `s`  | Active pipeline stage (`outline`/`skeleton`/`final`/...)       | `s=skeleton`         |
| `gs` | Active geometry-pipeline stage (`contours`/.../`animation`/`final`) | `gs=final`     |
| `m`  | Preview mode: `glyph` or `text`                                | `m=text`             |
| `t`  | Preview text                                                   | `t=Hello`            |
| `tm` | Time mode: `controlled` / `uncontrolled` / `css`               | `tm=controlled`      |
| `ct` | **Paused timeline position in seconds (controlled mode).** When present and > 0, the text preview loads **paused** at that time. Auto-updated on pause/seek/reset, left stale during playback. | `ct=1.25` |
| `as` | Animation speed multiplier                                     | `as=2`               |
| `fs` | Font size in px                                                | `fs=96`              |
| `lh` | Line height as a multiple of the font size (unset = CSS `normal`, the font's own line spacing) | `lh=1.2` |
| `w`  | Text frame width in px — the studio's resizable text frame, and `/preview`'s container width (unset = fill) | `w=320` |
| `ol` | Show debug overlay (0/1)                                       | `ol=1`               |
| `ghl` | Han stroke-order convention: `ja` (default, KanjiVG) or `zh` (Make Me a Hanzi) | `ghl=zh`     |
| `fx` | Effects state as JSON                                          | `fx=%7B...%7D`       |
| `pg` | Demo plugins switched on, comma-separated (`pen`, `order`, `brush`, `echo`, `sound`) | `pg=pen,order` |
| `se` / `ge` | Stroke / glyph easing preset                            | `se=ease-out-cubic`  |
| `pr` / `ss` | Render quality — pixel ratio / stroke segment size      | `pr=2&ss=1`          |

Pipeline options are also URL-addressable (`res`, `sk`, `bt`, `rt`, ... — see `OPTION_KEYS` in url-state.ts).

**Typical workflow for an agent inspecting a frame:**

1. Start the dev server (`bun dev`) if it isn't already running.
2. Navigate to a `/tegaki/preview/` URL encoding the desired state, e.g.
   `http://localhost:4321/tegaki/preview/?t=Hello&tm=controlled&ct=1.25&fs=96`
   Use `/preview` (not `/studio`) for visual testing — it has no chrome, so the rendered text fills the viewport and screenshots are easy to crop. Pass `w=…&h=…` to fix the container size in pixels (defaults to `100%`).
3. Take a screenshot / snapshot via whatever browser tooling is available (e.g. the `chrome-devtools` MCP — `new_page`, `navigate_page`, `take_screenshot`). The timeline will be **paused at `ct`**, so screenshots are deterministic. Wait for `body[data-tegaki-ready="true"]` (or `window.__tegakiPreviewReady`) before snapshotting so the font and bundle are guaranteed to be loaded.
4. To sweep frames, vary `ct` and re-navigate; the page does not hot-swap URL state, so a reload / re-navigation is required.
5. To capture the final frame, pass a `ct` value greater than the timeline duration — it clamps to the end and stays paused.

If you need to drive the interactive UI instead of taking a screenshot (e.g. flipping pipeline options through controls rather than URL params), use `/tegaki/studio/` with the same state keys.

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

A font that comes in several subset files (Fontsource's per-script subsets in the studio's Download Bundle, a multi-file Google Fonts response) also gets `<family>-1.ttf`, `<family>-2.ttf`, … — one per extra subset, listed in `extraFontUrls` with the `unicode-range` each draws in `extraFontRanges`; their variant glyphs are keyed `"<subset>:<gid>"` in `glyphDataById.json`.

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
- **Example smoke tests** (Playwright + Remotion render): [e2e/examples](e2e/examples) builds each consumer example (`vite`, `next`, `nuxt`, `remotion`) and asserts it actually draws handwriting. The `examples` job in [ci.yml](.github/workflows/ci.yml) runs these against the **workspace** package on every push/PR. A separate [release-smoke.yml](.github/workflows/release-smoke.yml) workflow re-runs the same checks against the **published npm tarball** after a release — see below.

### Post-release published-package check

The in-repo `examples` job links `tegaki` via `workspace:*`, so it validates the source but not the shipped artifact. [scripts/test-published-examples.ts](scripts/test-published-examples.ts) closes that gap: it copies each example *out of the workspace* (a workspace member is linked to the workspace package regardless of the version range written, so escaping it is required), pins the published version, strips the `tegaki@dev` resolve conditions so resolution falls through to the published `dist/` entry points, `bun install`s from npm, then typechecks + builds + smoke-tests each. [release-smoke.yml](.github/workflows/release-smoke.yml) runs it on the `release: published` event (parsing the version from the `tegaki@x.y.z` tag), with a `workflow_dispatch` for on-demand runs against any version or dist-tag. Run it locally with `bun scripts/test-published-examples.ts [version] [--no-smoke]` (version defaults to npm `latest`).

The same script also runs a **web-component CDN smoke** ([e2e/examples/check-wc-cdn.ts](e2e/examples/check-wc-cdn.ts)): it loads `tegaki/wc` + a font bundle from **esm.sh** at the published version (the channel the [hyperframes](examples/hyperframes) example uses), registers the `<tegaki-renderer>` element, and asserts it draws into its shadow-root canvas. Because esm.sh builds on first request, this polls esm.sh for a built module *separately* from the npm-registry propagation poll before opening a browser. It's only invoked from the post-release flow (not a `.e2e.ts` file, so the regular `examples` job skips it); run it standalone with `TEGAKI_VERSION=x.y.z bun --filter @tegaki/example-e2e wc-cdn`.

### Writing unit tests

Prefer the smallest layer that exercises the behaviour. If logic is buried inside a closure or hook, lift it out into a pure helper, export it, and test that — the way `lineReshapeSpans` and `isShapingWhitespace` are exported from [packages/renderer/src/shaper-harfbuzz/index.ts](packages/renderer/src/shaper-harfbuzz/index.ts) so [the tests](packages/renderer/src/shaper-harfbuzz/index.test.ts) can drive them without spinning up wasm. Each `test` should pin one behaviour, with a name that reads as the rule it locks in (e.g. `'a line ending at a space keeps its end as the paragraph shaped it'`).

The shaper shapes each paragraph whole, as Chrome does — contextual lookups reach across spaces (Caveat's `calt`) — and takes the layout's wraps as `ShapeOptions.lineBreaks`: a wrapped line's start is reshaped on its own up to the first glyph harfbuzz marks safe to break before, and a line broken inside a word has its end reshaped too (`lineReshapeSpans`). The engine passes every wrap the DOM made (`softBreaks` in [textLayout.ts](packages/renderer/src/lib/textLayout.ts)) to both the timeline and the layout, so both pick the glyphs the overlay draws.

### Visual snapshot tests

The Playwright suite drives [/tegaki/preview/](packages/website/src/components/preview/StandaloneTextPreview.tsx) (the chrome-free standalone renderer) with URL params and snapshots the `[data-tegaki-container]` element. Snapshots live in `tests/e2e/text-preview.e2e.ts-snapshots/` and are committed per platform — `*-chromium-darwin.png` and `*-chromium-linux.png`. CI runs the linux files in the Playwright Ubuntu image, so any new case needs **both**.

`playwright.config.ts` sets `maxDiffPixelRatio: 0.02` to tolerate sub-pixel antialiasing drift, and `animations: 'disabled'` while snapshotting. The runner waits on `body[data-tegaki-ready="true"]` and `document.fonts.ready` before capturing, so frames are deterministic as long as `tm=controlled` + a fixed `ct` are passed.

To add a case:

1. Append a `PreviewCase` to the `CASES` array (`previewUrl` leaves `pl` at the default geometry pipeline, the one the shipped bundles use; set `pl=raster` in the case to snapshot the raster pipeline) in [text-preview.e2e.ts](packages/website/tests/e2e/text-preview.e2e.ts) with deterministic params: `tm=controlled` + a fixed `ct` for a stable frame, `w` / `h` to fix the container size in pixels. Use `ol=1` and a mid-timeline `ct` when the case needs to lock in the canvas/overlay seam (both layers visible in one frame).
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
