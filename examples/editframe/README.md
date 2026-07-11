# @tegaki/example-editframe

A ~26s promo video that shows off [Tegaki](../../packages/renderer) handwriting
animations, composed with [Editframe](https://editframe.com). Five crossfaded
scenes write text stroke-by-stroke across Latin, Japanese, Korean and Hebrew
scripts.

## Run it

```bash
bun install          # from the repo root
bun --filter @tegaki/example-editframe start
```

`start` runs `editframe preview`, which prints a local URL. Open it and press
**Export** (top-right) to render the MP4.

This example resolves `tegaki` to the workspace **source** (via the `tegaki@dev`
condition in `vite.config.ts`), so it always reflects local changes to the
renderer without a build or publish.

## How the animation is driven

Editframe captures each export frame synchronously, so a React-state clock (e.g.
`useTimingInfo`) doesn't survive export — the re-render lands after the capture.
Instead, each word owns a `TegakiEngine` (see [`Handwriting.tsx`](src/Handwriting.tsx)),
and every scene registers an editframe [`addFrameTask`](src/Video.tsx) that pushes
per-frame writing progress straight into the engine via `update({ time })`, which
repaints the canvas synchronously. Scene crossfades are pure CSS (anchored to
`--ef-transition-out-start`) for the same reason.

> Note: `addFrameTask`'s callback receives a single frame-info object
> (`{ percentComplete, ownCurrentTimeMs, durationMs, … }`), not positional args.
