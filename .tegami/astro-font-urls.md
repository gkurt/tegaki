---
packages:
  tegaki: minor
---

## Load bundled fonts on server-rendered Astro pages

`tegaki/astro` renders on the server and passes the font bundle to the browser, but on the server Vite leaves a bundle's `new URL('./font.ttf', import.meta.url)` as it is. It evaluates to a `file://` path on the build machine, and the browser refuses to load it. The handwriting still drew, but laid out with a fallback font's letter widths. This affected every built Astro page, including the docs site.

The new `tegaki/astro/integration` fixes it. Add `integrations: [tegaki()]` (from `import tegaki from 'tegaki/astro/integration'`) to your Astro config. It makes Vite emit bundle fonts as assets and resolve their public URLs on the server as well, in both `astro build` and `astro dev`. Without it, the component now logs a build warning that names the fix.
