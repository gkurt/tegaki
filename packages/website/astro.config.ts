import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import type { AstroIntegration } from 'astro';
import { defineConfig, fontProviders } from 'astro/config';
import starlightThemeNova from 'starlight-theme-nova';
import { SHARED_HEAD_LINKS } from './src/seo.ts';
import { BASE, CARD_IMAGE, DOCS_DESCRIPTION, REPO_URL, SIDEBAR, SITE, TWITTER_URL } from './src/site.ts';

EventEmitter.defaultMaxListeners = 12;

const site = SITE;
const base = BASE;

// Pages kept out of search results: /preview renders only what its URL state
// asks for (blank without it), and /generator is a redirect to /studio.
const UNINDEXED_PAGES = ['/preview/', '/generator/'].map((path) => `${site}${base}${path}`);

/**
 * The sources behind each page, for the sitemap's <lastmod>: a docs page is
 * its MDX file, the home and studio pages their page file and components.
 */
const root = fileURLToPath(new URL('./', import.meta.url));

function pageSources(url: string): string[] {
  const path = url.slice(`${site}${base}/`.length).replace(/\/$/, '');
  if (path === '') return ['src/pages/index.astro', 'src/components/home', 'src/site.ts'];
  if (path === 'studio') return ['src/pages/studio.astro', 'src/components/studio', 'src/components/preview'];
  return [`src/content/docs/${path}.mdx`, `src/content/docs/${path}.md`].filter((file) => existsSync(`${root}${file}`));
}

/** When the page's sources last changed in git; needs the full history (deploy-docs.yml fetches it). */
function lastModified(url: string): string | undefined {
  const sources = pageSources(url);
  if (!sources.length) return undefined;
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', ...sources], { cwd: root, encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @astrojs/sitemap always writes an index (`sitemap-index.xml`) over numbered
 * chunks, even when every page fits in `sitemap-0.xml`. This turns that one
 * chunk into a plain `sitemap.xml` and drops the index. Must run after sitemap().
 */
const singleSitemap: AstroIntegration = {
  name: 'single-sitemap',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      if (existsSync(new URL('sitemap-1.xml', dir))) {
        throw new Error('The sitemap outgrew one chunk; remove singleSitemap and point robots.txt at sitemap-index.xml');
      }
      await rename(new URL('sitemap-0.xml', dir), new URL('sitemap.xml', dir));
      await rm(new URL('sitemap-index.xml', dir));
      logger.info('`sitemap.xml` written in place of the sitemap index');
    },
  },
};

export default defineConfig({
  site,
  base,
  integrations: [
    // Starlight adds a plain sitemap only when none is configured; this one skips the pages above.
    sitemap({
      filter: (page) => !UNINDEXED_PAGES.includes(page),
      serialize: (item) => ({ ...item, lastmod: lastModified(item.url) }),
    }),
    singleSitemap,
    starlight({
      title: 'Tegaki',
      description: DOCS_DESCRIPTION,
      logo: { light: './src/assets/tegaki.svg', dark: './src/assets/tegaki-dark.svg', alt: 'Tegaki logo' },
      head: [
        // Social cards need an absolute image URL; a relative one is ignored.
        { tag: 'meta', attrs: { property: 'og:image', content: CARD_IMAGE } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1280' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '640' } },
        { tag: 'meta', attrs: { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1' } },
        // llms.txt / llms-full.txt, PNG icons, and the sitemap — replacing Starlight's
        // default link to sitemap-index.xml (see singleSitemap).
        ...SHARED_HEAD_LINKS.map((attrs) => ({ tag: 'link' as const, attrs })),
      ],
      // A Markdown alternate and JSON-LD for each docs page.
      routeMiddleware: './src/route-middleware.ts',
      social: [
        { icon: 'github', label: 'GitHub', href: REPO_URL },
        { icon: 'twitter', label: 'Twitter', href: TWITTER_URL },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/tegaki' },
      ],
      sidebar: SIDEBAR,
      customCss: ['./src/styles/global.css'],
      plugins: [starlightThemeNova({ stylingSystem: 'tailwind' })],
    }),
    react({ include: ['**/*.tsx'], exclude: ['**/solid/**'] }),
    svelte(),
    vue(),
    solidJs({ include: ['**/solid/**'] }),
  ],
  // The home page's type (used through <Font> in index.astro). Self-hosted and
  // preloaded, with fallbacks sized to each font's metrics; `optional` means a
  // font that misses the first paint is skipped for that visit rather than
  // swapped in, so the text never reflows under the reader.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Instrument Serif',
      cssVariable: '--font-instrument-serif',
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      display: 'optional',
      fallbacks: ['serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Geist',
      cssVariable: '--font-geist',
      weights: ['400 600'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'optional',
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Geist Mono',
      cssVariable: '--font-geist-mono',
      weights: ['400 500'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'optional',
      fallbacks: ['monospace'],
    },
  ],
  devToolbar: {
    enabled: false,
  },
  // Astro doesn't read PORT on its own; honoring it lets tooling (e.g. the
  // Claude Code preview harness with autoPort) assign a free port when 4321
  // is taken. Unset PORT keeps the normal 4321 default.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : {},
  vite: {
    plugins: [tailwindcss() as any],
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
