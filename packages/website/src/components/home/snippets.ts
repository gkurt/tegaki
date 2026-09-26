/** The home page's "Every framework" tabs, also the quick starts in llms.txt and index.md. */
export interface FrameworkSnippet {
  id: string;
  label: string;
  lang: string;
  code: string;
}

export const FRAMEWORKS: FrameworkSnippet[] = [
  {
    id: 'react',
    label: 'React',
    lang: 'tsx',
    code: `import { TegakiRenderer } from 'tegaki';
import caveat from 'tegaki/fonts/caveat';

export const Note = () => (
  <TegakiRenderer font={caveat} style={{ fontSize: 56 }}>
    Hello, world!
  </TegakiRenderer>
);`,
  },
  {
    id: 'svelte',
    label: 'Svelte',
    lang: 'svelte',
    code: `<script>
  import { TegakiRenderer } from 'tegaki/svelte';
  import caveat from 'tegaki/fonts/caveat';
</script>

<TegakiRenderer font={caveat} text="Hello, world!"
  style="font-size: 56px" />`,
  },
  {
    id: 'vue',
    label: 'Vue',
    lang: 'vue',
    code: `<script setup>
import { TegakiRenderer } from 'tegaki/vue';
import caveat from 'tegaki/fonts/caveat';
</script>

<template>
  <TegakiRenderer :font="caveat" text="Hello, world!" />
</template>`,
  },
  {
    id: 'solid',
    label: 'Solid',
    lang: 'tsx',
    code: `import { TegakiRenderer } from 'tegaki/solid';
import caveat from 'tegaki/fonts/caveat';

export const Note = () => (
  <TegakiRenderer font={caveat} text="Hello, world!"
    style={{ 'font-size': '56px' }} />
);`,
  },
  {
    id: 'astro',
    label: 'Astro',
    lang: 'astro',
    code: `---
import TegakiRenderer from 'tegaki/astro';
import caveat from 'tegaki/fonts/caveat';
---

<TegakiRenderer font={caveat} text="Hello, world!" />`,
  },
  {
    id: 'wc',
    label: 'Web Component',
    lang: 'html',
    code: `<tegaki-renderer font="Caveat" text="Hello, world!">
</tegaki-renderer>

<script type="module">
  import { registerTegakiElement, TegakiEngine } from 'https://esm.sh/tegaki/wc';
  import caveat from 'https://esm.sh/tegaki/fonts/caveat';
  TegakiEngine.registerBundle(caveat);
  registerTegakiElement();
</script>`,
  },
  {
    id: 'vanilla',
    label: 'Vanilla',
    lang: 'js',
    code: `import { TegakiEngine } from 'tegaki/core';
import caveat from 'tegaki/fonts/caveat';

new TegakiEngine(document.querySelector('#note'), {
  font: caveat,
  text: 'Hello, world!',
});`,
  },
];
