# Tegaki

**Handwriting animation for any font**

Tegaki (手書き) turns any font into animated handwriting.
No manual path authoring. No native dependencies. Just pick a font.

[![npm](https://img.shields.io/npm/v/tegaki)](https://www.npmjs.com/package/tegaki)
[![license](https://img.shields.io/npm/l/tegaki)](https://github.com/KurtGokhan/tegaki/blob/main/LICENSE)

<br clear="both" />

<p align="center">
  <img src="media/hello-world.svg" alt="Hello World handwriting animation" width="500" />
</p>

---

## Quick Start

**1. Install**

```bash
npm install tegaki
```

**2. Use** (React example)

```tsx
import { TegakiRenderer } from 'tegaki';
import caveat from 'tegaki/fonts/caveat';

function App() {
  return (
    <TegakiRenderer font={caveat} style={{ fontSize: '48px' }}>
      Hello World
    </TegakiRenderer>
  );
}
```

That's it. The text draws itself stroke by stroke with natural timing.

## Framework Support

Tegaki works with all major frameworks:

```tsx
import { TegakiRenderer } from 'tegaki/react';   // React
import { TegakiRenderer } from 'tegaki/svelte';  // Svelte
import { TegakiRenderer } from 'tegaki/vue';     // Vue
import { TegakiRenderer } from 'tegaki/solid';   // SolidJS
```

```astro
---
import TegakiRenderer from 'tegaki/astro';       // Astro
---
```

```ts
import { TegakiEngine } from 'tegaki/core';      // Vanilla JS
import { registerTegakiElement } from 'tegaki/wc'; // Web Components
```

## Built-in Fonts

Several handwriting fonts are bundled and ready to use:

- **Caveat** — `tegaki/fonts/caveat` _(Latin)_
- **Italianno** — `tegaki/fonts/italianno` _(Latin)_
- **Tangerine** — `tegaki/fonts/tangerine` _(Latin)_
- **Parisienne** — `tegaki/fonts/parisienne` _(Latin)_
- **Suez One** — `tegaki/fonts/suez-one` _(Hebrew + Latin)_
- **Amiri** — `tegaki/fonts/amiri` _(Arabic + Latin)_
- **Tillana** — `tegaki/fonts/tillana` _(Devanagari + Latin)_
- **Klee One** — `tegaki/fonts/klee-one` _(Japanese: kana + Kyōiku grade 1–2 kanji + Latin)_

For other fonts, use the [interactive generator](https://gkurt.com/tegaki/generator/) to create a custom bundle.

## Documentation

Visit **[gkurt.com/tegaki](https://gkurt.com/tegaki)** for full documentation:

- [Getting Started](https://gkurt.com/tegaki/getting-started/)
- [Framework Guides](https://gkurt.com/tegaki/frameworks/react/) (React, Svelte, Vue, SolidJS, Astro, Web Components, Vanilla)
- [Generating Fonts](https://gkurt.com/tegaki/guides/generating/)
- [API Reference](https://gkurt.com/tegaki/api/renderer/)

## Integrations

- [Sli.dev](https://sli.dev/) - Create presentations using markdown. [See Tegaki integration example](https://andreas-taranetz.github.io/slidev-addon-animated-text/)
- [Remotion](https://www.remotion.dev/) - Create videos programmatically with React. [See Tegaki integration example](https://github.com/KurtGokhan/tegaki/blob/gokhan/support-font-features/examples/remotion/src/Root.tsx)

## License

[MIT](LICENSE)
