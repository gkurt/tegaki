import { EventEmitter } from 'node:events';
import react from '@astrojs/react';
import solidJs from '@astrojs/solid-js';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightThemeNova from 'starlight-theme-nova';

EventEmitter.defaultMaxListeners = 12;

export default defineConfig({
  site: 'https://gkurt.com',
  base: '/tegaki',
  integrations: [
    starlight({
      title: 'Tegaki',
      description:
        'Animated handwriting from any font. Generate stroke data, render beautiful writing animations in React, Svelte, Vue, SolidJS, Astro, Web Components, or vanilla JS.',
      logo: { src: './src/assets/tegaki.svg', alt: 'Tegaki logo' },
      head: [{ tag: 'meta', attrs: { property: 'og:image', content: '/tegaki/tegaki-card.png' } }],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/KurtGokhan/tegaki' },
        { icon: 'twitter', label: 'Twitter', href: 'https://twitter.com/gkurttech' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/tegaki' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ label: 'Getting Started', slug: 'getting-started' }],
        },
        {
          label: 'Frameworks',
          items: [
            { label: 'React', slug: 'frameworks/react' },
            { label: 'Svelte', slug: 'frameworks/svelte' },
            { label: 'Vue', slug: 'frameworks/vue' },
            { label: 'Nuxt', slug: 'frameworks/nuxt' },
            { label: 'SolidJS', slug: 'frameworks/solid' },
            { label: 'Astro', slug: 'frameworks/astro' },
            { label: 'Web Components', slug: 'frameworks/web-components' },
            { label: 'Vanilla JS', slug: 'frameworks/vanilla' },
            { label: 'Remotion', slug: 'frameworks/remotion' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Generating Font Data', slug: 'guides/generating' },
            { label: 'Rendering Animations', slug: 'guides/rendering' },
            { label: 'Streaming Text', slug: 'guides/streaming' },
            { label: 'Text Shaping', slug: 'guides/shaping' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'TegakiRenderer', slug: 'api/renderer' },
            { label: 'Generator CLI', slug: 'api/generator' },
          ],
        },
        {
          label: 'Demos',
          items: [{ label: 'Generator', link: '/generator/' }],
        },
      ],
      customCss: ['./src/styles/global.css'],
      plugins: [starlightThemeNova({ stylingSystem: 'tailwind' })],
    }),
    react({ include: ['**/*.tsx'], exclude: ['**/solid/**'] }),
    svelte(),
    vue(),
    solidJs({ include: ['**/solid/**'] }),
  ],
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      conditions: ['tegaki@dev', 'browser'],
    },
    build: {
      rollupOptions: {
        external: [/^node:/, 'bun'],
      },
    },
    ssr: {
      resolve: {
        conditions: ['tegaki@dev'],
        externalConditions: ['tegaki@dev'],
      },
    },
  },
});
