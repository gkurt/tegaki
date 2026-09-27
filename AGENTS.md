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
    plugins.ts                # Runs a plugin list's hooks as one: geometry and timing in sequence, paint as a chain of next() ending in paintStroke, for every stroke — pending ones too, which paintStroke skips — with `unclipped`, a layer clip-to-text doesn't cut, laid under the clipped ink before the ink hooks; plugin `steps` (a cycle of drawings: stepAt / pluginStepsAt / allPluginSteps)
    createPlugin.ts           # createPlugin() — a plugin factory that takes options: typed params (number / boolean / select / color / text) and presets a UI can build controls from, resolve() for untrusted input
  plugins/
    variation.ts              # variationPlugin — each glyph a little different (size, slant, rotation, drift, warp, width) from its seed; one displacement field moves strokes and clip outline alike
    boil.ts                   # boilPlugin — line boil: `steps` drawings, each a smooth field per glyph and drawing; `idle` keeps it cycling after the text is written
    glyphSpace.ts             # inPx() — a field over a glyph's font units as a move of text-box px points (shared by variation and boil)
    groups.ts                 # groupStrokes() — strokes gathered into the text, lines or words (a word: glyphs between gaps where the text skips a character), in text order
    annotate.ts               # annotatePlugin — hand-drawn underline / double / strike / cross / circle / box / highlight on the text, each line or word (or one of them); `timing` makes the time after the writing (or after each), overlay + highlighter underlay + svg
    textPath.ts               # textPathPlugin — the text laid on an arc (±360° = a circle) or a wave, glyphs turned along it, upright or bent; geometry + outline by `ctx.textBox`, a flowing wave on `steps`
    caption.ts                # captionPlugin — each word written in its cue (word timings as JSON or `start end word` lines, a `text` param; parseCues), or at a pace in words a minute; timing
    effectPlugins.ts          # The built-in effects as plugins (pressureWidth/taper/wobble = geometry, gradients = paint, glow = paint per stroke, or ink with clip-to-text — only over the ink's box, downsampled); run ahead of the user's
    drawGlyph.ts              # drawGlyph() — one glyph through the same plugins, for use outside the engine
    createBundle.ts           # Builds a TegakiBundle from parts
    bundle-registry.ts        # Global bundle registry (register/lookup by family name)
    render-elements.ts        # Low-level SVG element construction
    types.ts                  # Engine-level types (TimeControlProp, effect config, etc.)
  lib/                        # Shared helpers used by both core and adapters
    timeline.ts               # computeTimeline() — per-grapheme animation schedule
    strokeTimeline.ts         # The timeline per stroke: strokeInstances(), the one stroke clock (the canvas, svgExport and frameAt all read it), retimeTimeline() — a timeline with its strokes at the times plugins' `timing` gave them — placeStrokes() — each stroke's rawPath reshaped by the plugins' geometry into its ink, a StrokePath in text-box px — and sampleFrame(), the pen head per stroke
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
  astro/integration.ts        # `tegaki/astro/integration` — on the server, rewrites bundle font URLs to `?url` asset imports (Vite leaves `new URL(…, import.meta.url)` a file:// path there); the adapter warns without it
  wc/                         # Web Component adapter (`<tegaki-renderer>`)
```

Pre-generated font bundles live outside `src/`, under `packages/renderer/fonts/<family>/` and are regenerated via `bun --filter tegaki generate-fonts`.

### Generator (`packages/generator`)

CLI entry point uses Padrone. The `generate` command orchestrates a pipeline that processes each glyph through several stages. `--pipeline` picks the stroke extraction: `geometry` (default — outline-geometry ink-graph extraction in `src/geometry/`, ordered by KanjiVG / Make Me a Hanzi / Hershey / Hangul references; the shipped bundles use it) or `raster` (below). Han characters follow one national convention per bundle, set by `--han-locale`: `ja` (default — KanjiVG first) or `zh` (Make Me a Hanzi, PRC order, first); the other dataset only fills characters the first lacks (`createReferenceSet` in [providers.ts](packages/generator/src/stroke-order/providers.ts)). A ligature has no reference of its own, so an LTR one is drawn letter by letter: its components' advances, laid end to end, mark each letter's slot, every stroke joins the letter holding its ink's midpoint, and each letter is ordered by its own references registered onto its own ink (`ligatureComponentEdges` / `componentSlots` in [ordering.ts](packages/generator/src/geometry/ordering.ts); RTL, headline-script and fraction ligatures keep the heuristic order). `--font-file <path.ttf|otf>` reads a local font instead of Google Fonts (all three commands below take it): the font is subset to the requested characters with hb-subset ([font/subset.ts](packages/generator/src/font/subset.ts)), the bundle takes the font's own family name, and the whole file is bundled as the fallback font (as `<family-slug>.ttf`, like the Google full downloads) only with `--full-font` — CJK fonts are tens of MB whole. Every `GeometryOptions` field is a flag too (`--extraction`, `--stroke-order`, `--ink-spur-tolerance`, …; defaults from `DEFAULT_GEOMETRY_OPTIONS`), and `--debug` writes each glyph's pipeline stages (SVG/PNG, plus the geometry warnings) under `<output>/debug/<glyph>/`.

Two scoreboard commands measure the pipeline over a character set — run them before and after a change and compare the summaries:

- `bun start coverage-report <Family> [-c chars] [-t tolerance] [--<geometry flag> …] [-j report.json]` — share of each glyph's rasterized ink no stroke pen or nib paints, geometry vs raster, with the worst offenders. The tolerance is in font units (default 2) so dots and letters are judged alike ([coverage-report.ts](packages/generator/src/commands/coverage-report.ts)).
- `bun start stroke-order-report <Family> [-c chars] [--han-locale ja|zh] [-j report.json]` — stroke-order agreement with the references (KanjiVG or Make Me a Hanzi, Hershey, and Hangul jamo templates): how many glyphs match 1:1 and take the dataset order, and how many are only *reference-guided* — Han, kana and Hangul strokes the font merges, ordered by where their ink runs along the reference ([stroke-order-report.ts](packages/generator/src/commands/stroke-order-report.ts), [guide.ts](packages/generator/src/stroke-order/guide.ts)).

Both are gated in CI over the shipped bundles by `bun --filter tegaki scoreboard [dir…] [--update]` ([scripts/scoreboard.ts](packages/renderer/scripts/scoreboard.ts), [scoreboard.ts](packages/generator/src/commands/scoreboard.ts)): it reruns the pipelines on each bundle's committed font subset (offline; the font can't drift) with the bundle's own charset and Han locale ([bundled-fonts.ts](packages/renderer/scripts/bundled-fonts.ts), shared with `generate-fonts`), scores each glyph once — geometry unpainted share, stroke count, and whether its order is `dataset` / `guided` / `heuristic` — and compares with the baselines in `packages/renderer/scoreboard/<dir>.json`, one glyph per line. A glyph regresses when geometry leaves more than one more percentage point of its ink unpainted, stops drawing, falls in order (dataset → guided → heuristic), loses its reference stroke count, or shatters (≥ 1.5× and ≥ 3 more strokes); the font regresses when its mean unpainted share rises by more than 0.1 point. The [Scoreboard workflow](.github/workflows/scoreboard.yml) runs it in four equal-cost shards (`--shard i/4`) whenever the generator, a bundle or a baseline changes, and writes the comparison to the job summary. After an intended change, rerun with `--update` and commit the baselines — the diff then reads glyph by glyph in review. The generator's own `bun start scoreboard --font-file … --baseline … [--<geometry flag> …]` compares one font against a baseline, so a flag can be tried before it becomes the default.

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
      plugins/                # Demo TegakiPlugins for the studio's Plugins tab (index.ts lists them in the order they run), plus their shared helpers: color.ts, noise.ts (paper texture), ink-canvas.ts (an ink hook's region, a blurred silhouette)
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
    site.ts                   # Site facts shared by astro.config.ts, page heads and agent files: URLs, sidebar, bundled fonts, FAQ
    seo.ts                    # schema.org JSON-LD (home, studio, docs) and the <head> links every page shares
    route-middleware.ts       # Starlight route middleware: each docs page's Markdown alternate link + TechArticle JSON-LD
    llms/                     # Agent-facing text: mdx-to-markdown.ts (docs MDX → plain Markdown), content.ts (llms.txt, llms-full.txt, index.md, sitemap.md, skill.md)
    pages/*.md.ts pages/*.txt.ts  # Endpoints writing those files: /llms.txt, /llms-full.txt, /skill.md, /sitemap.md, /index.md, and /<doc>.md next to every docs page
```

SEO / agent readiness: every docs page has a Markdown mirror at its path + `.md`, listed in `llms.txt`; the sitemap's `<lastmod>` is each page's last git commit (deploy-docs.yml checks out full history). A new docs page needs an entry in `SIDEBAR` ([site.ts](packages/website/src/site.ts)); a new MDX component used in the docs needs a rule in [mdx-to-markdown.ts](packages/website/src/llms/mdx-to-markdown.ts) so the Markdown stays clean. Keep the home page's FAQ (`FAQ` in site.ts, also its FAQPage JSON-LD and llms.txt) true to the library.

Dev server: `bun dev` → Astro at `http://localhost:4321/tegaki/`. Two preview routes share the same URL-state schema:

- `/tegaki/studio/` — the interactive UI (`Studio`): Text / Glyphs modes, font picker + Export in the top bar, and an inspector (Style / Motion / Pipeline) docked right on desktop, a bottom sheet below 1024px. Controls are [DialKit](https://github.com/joshpuckett/dialkit) components (`Slider`, `Toggle`, `SelectControl`, …) inside a themed `DialScope` ([dial.tsx](packages/website/src/components/studio/inspector/dial.tsx)); light/dark follows the docs' theme.

Glyphs mode inspects one character through the pipeline stages; the last stage, **Final**, is the real renderer (`TegakiTextPreview`) drawing the glyph with the Style / Motion settings. The glyph list's header picks the character set: `charsetCoverage` / `recommendCharset` ([charsets.ts](packages/website/src/components/studio/charsets.ts)) star the preset that fits the font, and picking a font in the studio adopts that preset when the current set is an unedited preset (a font restored from the URL keeps its `ch`).

A character can be drawn with more than one glyph — contextual alternates (Caveat swaps in `a.ss01` / `a.ss02` for a repeated letter), ligatures, Arabic positional forms. The **Forms** strip above the stage lists them for the selected character, from the font's GSUB table (`buildGsubGraph` / `glyphFormsOf` in [glyph-forms.ts](packages/generator/src/font/glyph-forms.ts), per font subset), each tagged with the feature that brings it in. `findFormExamples` shapes candidate texts with harfbuzz (the renderer's features) to find one that really draws each form; picking a form runs every stage on that glyph, and Final draws it in that text, outlined. Forms no text brings up (a feature switched off, or `init`/`fina` on Latin, which harfbuzz never applies) are dimmed with the reason. The glyph list badges characters that have forms; the selected form is the `gv` param ([GlyphForms.tsx](packages/website/src/components/studio/GlyphForms.tsx)).

In controlled time the transport's loop button toggles looping (the `lo` param, which uncontrolled time's Loop shares): playback holds the last frame for `LOOP_HOLD_MS`, then starts over; Home still goes back to the start. Text mode draws a dashed frame around the rendered text: drag its right edge (Shift snaps to 10px, arrow keys on the handle step it), pick a width preset or type one from the width label, and Reset / double-click the handle to go back to Auto. The width is the `w` param, so `/preview` and the agent prompt wrap the text the same way ([TextFrame.tsx](packages/website/src/components/studio/TextFrame.tsx)). Hovering a character outlines it and clicking selects it; the selected character's ↗ button opens it in Glyphs mode, adding it to the character set if it's missing. The picker reads the renderer's timeline for the glyph it drew there ([glyph-cluster.ts](packages/website/src/components/studio/glyph-cluster.ts)): a ligature is outlined and picked as one, and when the glyph is one of the character's forms the button names it (`a.ss02 · calt`, `ffi ligature`) and opens that form. Character boxes are measured from the renderer's DOM text layer (`[data-tegaki="overlay"]`) with Ranges ([GlyphPicker.tsx](packages/website/src/components/studio/GlyphPicker.tsx), [glyph-hit.ts](packages/website/src/components/studio/glyph-hit.ts)).

"Ask an agent" (next to Export; in the ⋯ menu on phones) copies a Markdown prompt for a coding agent — goal (generate / optimize / fix), the font, charset, non-default settings as CLI flags, the inspected glyph's warnings, and studio + `/preview` links to iterate on. It's built by the pure `buildAgentPrompt` in [agent-prompt.ts](packages/website/src/components/studio/agent-prompt.ts); keep its iteration tips in step with this file.

A `geometry` or `outline` hook gets `textBox` (the box the text's lines fill) as well as its glyph's `place`, so a plugin can lay out the whole text — Text on a path measures its curve by it; the clip outline cache is keyed on it.

The renderer's `seed` (default `0`, so a render is the same on every load and in every Remotion tab; `'random'` opts into a new look per mount, read back from `engine.seed`) is the Seed slider + 🎲 in Style → Effects and the Plugins tab, and the `rs` param.

Plugin `steps` (`{ count, fps, idle? }`): the engine reshapes each drawing once per layout (`ctx.step` in `geometry` / `outline`), caches them all (`_placedStrokes(steps)`, clip outlines keyed by the step), sizes the canvas to every drawing, and picks one per render — from the time in controlled mode, the clock otherwise; the painting hooks get it as `step` too, and a plugin with no `geometry` / `outline` isn't placed per step (`shapeSteps`), so steps can be a paint-only clock (neon's flicker); `idle` runs a redraw loop after the text is written (uncontrolled / CSS time), and reduced motion holds drawing 0.

A plugin's `timing` retimes the strokes: it runs once per layout on the placed strokes (so where a stroke is can decide when it draws), and `retimeTimeline` folds its `{ start, duration }` per stroke back into the timeline — a moved glyph's slot becomes the span of its strokes, with per-stroke `strokeDelays` / `strokeDurations`; strokeless entries (fallback characters) keep their distance from the entry before. The engine keeps the scheduled timeline (`_scheduled`) and serves the retimed one as `_timeline` (lazily, memoized on the scheduled timeline, the placed strokes and the plugins), so `duration`, `strokes`, `frameAt`, CSS time, `onComplete` and `toSVG` all play it; placement always reads `_scheduled`, and `onChangeTimeline` fires from the next render when a `timing` plugin is on (the layout it needs may be stale until then).

`toSVG` draws the placed strokes (`SvgGlyphPlacement.inks`: each stroke's path as `geometry` shaped it, moved by the canvas padding; the exporter's own wobble / taper / pressure only run for placements without inks), clips to outlines the `outline` hooks reshaped (`SvgGlyphOutline.placed`), and plays the retimed timeline. A plugin's `svg(ctx)` hook draws what its painting hooks paint on the canvas: `defs`, `underlay` / `overlay` markup, `ink` attributes around the ink, per-stroke `style` (color, attributes), and the file's clock (`appear(t)`, `seconds(t)`, `mode`) — collected by `placementsToSvg`'s `decorate` callback once its animator exists ([svgExport.ts](packages/renderer/src/lib/svgExport.ts), `_svgDecoration` in engine.ts). Colors, Shadow, Practice paper and Stroke order have one (SVG markup helpers in `components/plugins/svg.ts`).

The inspector's **Plugins** tab (Text mode) switches on the shipped `variationPlugin` (issue #31), `boilPlugin`, `textPathPlugin`, `captionPlugin` and `annotatePlugin`, and demo plugins that show off the renderer's `TegakiPlugin` API, written the way a user of `tegaki` would: one or more per hook: slant, a shaky hand and a broad calligraphy nib (geometry); a hand's rhythm — pen travel between strokes, a steady pace, pauses to think — a sweep drawing the strokes by where they are, and cursive joins, hairlines the pen draws from letter to letter within a word, with time made for them (timing + paint, on `unclipped`); practice paper — ruled lines, 田字格 / 米字格 squares or graph paper, laid out by each stroke's `place`, with a tracing guide (underlay); stroke-order numbers and arrows kept clear of the ink (underlay + overlay); palette colors, a ballpoint that skips, graphite with dust and splinters, wet ink that pools and dries lighter behind the pen (from the frame's time), a bristly brush that becomes a great scroll brush (Size / Press / Splatter), and echo passes (paint — the widened brush, the nib, echo's passes, splatter and graphite splinters go on the paint context's `unclipped` layer, so clip-to-text doesn't trim them); a felt-tip marker or highlighter that darkens where strokes cross (`multiply`, one width per stroke so it's one canvas stroke), spray paint with overspray and drips (and a `timing` hook that runs the timeline on for them), hatching (each stroke clipped to its ink and ruled with lines placed on the page, so overlaps share them), embroidery (satin, running or cross stitch on linen), chalk on a blackboard shedding dust, gold foil catching the light with a glint on `steps`, a flame burning the text in — cooling to char, scorched, smoking (paint, with underlays, ink hooks and overlays of their own); neon that sputters and hums (paint-only `steps` as its clock, `idle` to flicker on); a laser that writes with a beam and a cooling line; a segment of ink that travels along the writing behind the pen — the text's color and the stroke's width unless bulged, narrowed or recolored, over the ink or with Hide strokes instead of it (paint, passing a slice of each stroke to the painters after it, + a `timing` hook that runs the timeline on until it has left the last stroke); a typewriter striking whole glyphs at a typist's pace with a blinking caret, and an eraser rubbing the text out (each retimes the strokes with `timing` — the keys, or time after the writing for the erasing — and `paint` sees every stroke, pending ones too, and the whole `frame`); paper grain, ink bleed, a drop shadow with an emboss bevel, a cathode tube and screen shake (ink, which gets the `frame` too); sparkles, a karaoke ball and bar, and a fountain pen / pencil / quill at the pen head (overlay); a pencil scratch sound and phone haptics (onFrame). Each is made with `createPlugin` ([createPlugin.ts](packages/renderer/src/core/createPlugin.ts)), and the tab builds its controls — the description in an ⓘ tooltip by the name (`InfoTip` in ui.tsx), preset chips, then a DialKit control per param — from the factory's `description` / `params` / `presets`, so a new param or preset shows up in the UI with no panel code. They live in [components/plugins/](packages/website/src/components/plugins) and are only for showing: the `pg` param (which are on) and `po` (their changed options) carry them to `/preview`, but Export and Ask an agent leave them out.
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
| `pg` | Plugins switched on, comma-separated (`vary`, `boil`, `slant`, `shaky`, `path`, `nib`, `rhythm`, `joins`, `caption`, `sweep`, `paper`, `order`, `colors`, `type`, `annotate`, `erase`, `segment`, `ball`, `graphite`, `wet`, `marker`, `spray`, `hatch`, `stitch`, `chalk`, `foil`, `burn`, `neon`, `laser`, `brush`, `echo`, `grain`, `bleed`, `shadow`, `crt`, `shake`, `sparkle`, `karaoke`, `pen`, `sound`, `haptics`) | `pg=vary,pen` |
| `po` | Demo plugins' options as JSON, by plugin id — only non-defaults, only for plugins in `pg`; resolved through each factory's params (numbers clamped, unknown keys dropped) | `po=%7B%22echo%22%3A%7B%22lag%22%3A0.2%7D%7D` |
| `rs` | The renderer's `seed` (unset = 0): wobble phase, gradient hue, what Variation, Boil, Annotate's marks and the random demos (Chalk, Spray, Burn, Brush, Ballpoint, Shaky hand, Graphite, Neon's flicker, Sparkles, shuffled Colors, Hand rhythm's pauses, Sweep's scatter, the Typewriter's rhythm) draw by | `rs=42` |
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
- **Visual / e2e tests** (Playwright): live in [packages/website/tests/e2e/*.e2e.ts](packages/website/tests/e2e) — committed screenshot snapshots ([text-preview.e2e.ts](packages/website/tests/e2e/text-preview.e2e.ts)) and a snapshot-free render check for every engine ([cross-browser.e2e.ts](packages/website/tests/e2e/cross-browser.e2e.ts)), sharing `previewUrl` / `waitForReady` from [preview.ts](packages/website/tests/e2e/preview.ts). The `.e2e.ts` extension is intentional — `bun test` matches `*.spec.ts` / `*.test.ts`, so the e2e files stay out of the unit suite.
- **Example smoke tests** (Playwright + Remotion render): [e2e/examples](e2e/examples) builds each consumer example (`vite` — React, `next`, `nuxt`, `svelte`, `vue` — with Amiri through the harfbuzz shaper, `solid`, `astro` — static build, SSR + hydration, `vanilla` — `tegaki/wc` + `tegaki/core`, and `remotion`) and asserts it actually draws handwriting: each served example is an entry in `EXAMPLES` ([playwright.config.ts](e2e/examples/playwright.config.ts)), whose `renderers` selectors must each draw ink of their own (shadow roots included), with no console or page errors. A new example also goes in root `build:examples` and `WEB_EXAMPLES` in [test-published-examples.ts](scripts/test-published-examples.ts). The `examples` job in [ci.yml](.github/workflows/ci.yml) runs these against the **workspace** package on every push/PR. A separate [release-smoke.yml](.github/workflows/release-smoke.yml) workflow re-runs the same checks against the **published npm tarball** after a release — see below.

### Browser matrix

Both Playwright suites run in Chromium, WebKit and Firefox — WebKit because every iOS browser is WebKit (Safari and Chrome alike; gkurt/tegaki#29 was the renderer not showing on an iPhone). CI's Playwright image ships all three.

- **Examples** ([e2e/examples/playwright.config.ts](e2e/examples/playwright.config.ts)): every example in `chromium`, `webkit`, `firefox` and `mobile-webkit` (iPhone viewport, touch, 3× pixel ratio). The smoke asserts the renderer's own canvases (web components' shadow roots included) hold ink, that the ink keeps changing (the rAF loop animates — not a canvas painted once or the fallback text), and no page errors; a tainted canvas is reported by name.
- **Website** ([packages/website/playwright.config.ts](packages/website/playwright.config.ts)): `chromium` runs every spec; `webkit` and `firefox` run only `cross-browser.e2e.ts`, since the pixel snapshots are committed for Chromium alone. That spec renders a spread of `/preview` URLs (Caveat, Amiri RTL, Tillana, Klee One, glow + rainbow gradient, uncontrolled and `css` time) and checks structure that holds in any engine: the ink lies inside the container and over the DOM overlay's text, spans it, covers a plausible share of it, grows from nothing at `t=0` through mid-way to the end (scrubbed through the preview's `window.__tegakiEngine`), is written from the left for LTR and from the right for RTL, carries the gradient's hues; uncontrolled time plays to completion on its own; `css` time follows `--tegaki-progress`. Add a case to its `CASES` when a feature could break in one engine only — no baselines to generate.

Run one engine with `--project`: `cd packages/website && bun test:e2e --project=webkit`, or `bun --filter @tegaki/example-e2e test --project=firefox`. Locally, install the extra engines once with `bunx playwright install webkit firefox` (plus `bunx playwright install-deps webkit firefox` on Linux).

### Post-release published-package check

The in-repo `examples` job links `tegaki` via `workspace:*`, so it validates the source but not the shipped artifact. [scripts/test-published-examples.ts](scripts/test-published-examples.ts) closes that gap: it copies each example *out of the workspace* (a workspace member is linked to the workspace package regardless of the version range written, so escaping it is required), pins the published version, strips the `tegaki@dev` resolve conditions so resolution falls through to the published `dist/` entry points, `bun install`s from npm, then typechecks + builds + smoke-tests each. [release-smoke.yml](.github/workflows/release-smoke.yml) runs it on the `release: published` event (parsing the version from the `tegaki@x.y.z` tag), with a `workflow_dispatch` for on-demand runs against any version or dist-tag. Run it locally with `bun scripts/test-published-examples.ts [version] [--no-smoke]` (version defaults to npm `latest`).

The same script also runs a **web-component CDN smoke** ([e2e/examples/check-wc-cdn.ts](e2e/examples/check-wc-cdn.ts)): it loads `tegaki/wc` + a font bundle from **esm.sh** at the published version (the channel the [hyperframes](examples/hyperframes) example uses), registers the `<tegaki-renderer>` element, and asserts it draws into its shadow-root canvas. Because esm.sh builds on first request, this polls esm.sh for a built module *separately* from the npm-registry propagation poll before opening a browser. It's only invoked from the post-release flow (not a `.e2e.ts` file, so the regular `examples` job skips it); run it standalone with `TEGAKI_VERSION=x.y.z bun --filter @tegaki/example-e2e wc-cdn`.

### Writing unit tests

Prefer the smallest layer that exercises the behaviour. If logic is buried inside a closure or hook, lift it out into a pure helper, export it, and test that — the way `lineReshapeSpans` and `isShapingWhitespace` are exported from [packages/renderer/src/shaper-harfbuzz/index.ts](packages/renderer/src/shaper-harfbuzz/index.ts) so [the tests](packages/renderer/src/shaper-harfbuzz/index.test.ts) can drive them without spinning up wasm. Each `test` should pin one behaviour, with a name that reads as the rule it locks in (e.g. `'a line ending at a space keeps its end as the paragraph shaped it'`).

The shaper shapes each paragraph whole, as Chrome does — contextual lookups reach across spaces (Caveat's `calt`) — and takes the layout's wraps as `ShapeOptions.lineBreaks`: a wrapped line's start is reshaped on its own up to the first glyph harfbuzz marks safe to break before, and a line broken inside a word has its end reshaped too (`lineReshapeSpans`). The engine passes every wrap the DOM made (`softBreaks` in [textLayout.ts](packages/renderer/src/lib/textLayout.ts)) to both the timeline and the layout, so both pick the glyphs the overlay draws.

### Visual snapshot tests

The Playwright suite drives [/tegaki/preview/](packages/website/src/components/preview/StandaloneTextPreview.tsx) (the chrome-free standalone renderer) with URL params and snapshots the `[data-tegaki-container]` element. Snapshots live in `tests/e2e/text-preview.e2e.ts-snapshots/` and are committed per platform — `*-chromium-darwin.png` and `*-chromium-linux.png` — for Chromium only (the other engines run the snapshot-free `cross-browser.e2e.ts`; see [Browser matrix](#browser-matrix)). CI runs the linux files in the Playwright Ubuntu image, so any new case needs **both**.

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
