// Site-wide facts shared by astro.config.ts (Starlight, sitemap), the page
// heads (meta tags, JSON-LD) and the agent-facing files (llms.txt, the .md
// mirrors, skill.md), so a rename or a new page updates all of them at once.

export const SITE = 'https://gkurt.com';
export const BASE = '/tegaki';
export const SITE_URL = `${SITE}${BASE}/`;

export const NAME = 'Tegaki';
export const REPO_URL = 'https://github.com/gkurt/tegaki';
export const NPM_URL = 'https://www.npmjs.com/package/tegaki';
export const TWITTER_HANDLE = '@gkurttech';
export const TWITTER_URL = 'https://twitter.com/gkurttech';
export const CARD_IMAGE = `${SITE_URL}tegaki-card.png`;
export const LOGO_IMAGE = `${SITE_URL}apple-touch-icon.png`;

export const AUTHOR = { name: 'Gokhan Kurt', url: 'https://gkurt.com', sameAs: ['https://github.com/gkurt', TWITTER_URL] };

/** One sentence: what Tegaki is. Leads llms.txt and the structured data. */
export const TAGLINE =
  'Tegaki is an open-source handwriting animation library and generator for the web: it turns any font into text that writes itself stroke by stroke, in the order a hand would draw it.';

/** The docs' default meta description (Starlight's `description`). */
export const DOCS_DESCRIPTION =
  'Docs for Tegaki, the handwriting animation library: generate stroke data from any font and animate handwriting in React, Svelte, Vue, SolidJS, Astro, Web Components, vanilla JS or Remotion.';

export const FRAMEWORKS = ['React', 'Svelte', 'Vue', 'Nuxt', 'SolidJS', 'Astro', 'Web Components', 'vanilla JavaScript', 'Remotion'];

/** The bundles under `tegaki/fonts/*`, as [import name, font, script]. */
export const BUNDLED_FONTS: [string, string, string][] = [
  ['caveat', 'Caveat', 'Latin'],
  ['italianno', 'Italianno', 'Latin'],
  ['tangerine', 'Tangerine', 'Latin'],
  ['parisienne', 'Parisienne', 'Latin'],
  ['suez-one', 'Suez One', 'Hebrew'],
  ['amiri', 'Amiri', 'Arabic'],
  ['tillana', 'Tillana', 'Devanagari'],
  ['atma', 'Atma', 'Bengali'],
  ['klee-one', 'Klee One', 'Japanese'],
  ['nanum-pen-script', 'Nanum Pen Script', 'Korean'],
  ['lxgw-wenkai', 'LXGW WenKai', 'Simplified Chinese'],
];

export type SidebarItem = { label: string; slug: string } | { label: string; link: string };
export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

/** Starlight's sidebar; llms.txt, llms-full.txt and sitemap.md list the docs in this order. */
export const SIDEBAR: SidebarGroup[] = [
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
      { label: 'Bundler Setup', slug: 'guides/bundlers' },
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
    items: [
      { label: 'Studio', link: '/studio/' },
      { label: 'Videos', slug: 'demos/videos' },
    ],
  },
];

/** Every docs slug in sidebar order. */
export const DOC_SLUGS = SIDEBAR.flatMap((group) => group.items.flatMap((item) => ('slug' in item ? [item.slug] : [])));

/** Common questions, answered on the home page (visible, and as FAQPage JSON-LD) and in llms.txt. */
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Tegaki?',
    a: 'Tegaki is an open-source (MIT) handwriting animation library and generator. It extracts the strokes, stroke order and stroke width of every glyph in a font, then animates text being written by hand on a canvas drawn over real, selectable DOM text.',
  },
  {
    q: 'How do I add a handwriting animation to my website?',
    a: 'Install the package with `npm i tegaki`, import a font bundle such as `tegaki/fonts/caveat`, and render `<TegakiRenderer font={caveat}>Hello</TegakiRenderer>`. Adapters exist for React, Svelte, Vue, Nuxt, SolidJS, Astro, Web Components and vanilla JavaScript; Remotion renders the same animation to video.',
  },
  {
    q: 'Can Tegaki animate any font?',
    a: 'Yes. Eleven fonts ship ready to import, and the free Tegaki Studio generates a bundle from any Google Font or your own .ttf/.otf file in the browser, with no server. Handwriting and script fonts look most natural, but any outline font works.',
  },
  {
    q: 'Which languages and writing systems are supported?',
    a: 'Latin, Hebrew and Arabic (right to left, with positional forms), Devanagari and Bengali, Japanese, Korean and Simplified Chinese. Chinese, Japanese and Korean characters follow reference stroke order from KanjiVG and Make Me a Hanzi, and text is shaped with HarfBuzz.',
  },
  {
    q: 'How is Tegaki different from an SVG stroke-dashoffset animation?',
    a: 'A stroke-dashoffset trick traces the outline of the letters, so the pen goes around each glyph twice. Tegaki animates the centerline of each stroke with its real width, in natural stroke order, and supports timeline control, streaming text, effects and every writing system above.',
  },
  {
    q: 'Can I control or scrub the animation?',
    a: "Yes. Pass `time` as seconds, a percentage such as `'50%'`, or `'css'` to read progress from the `--tegaki-progress` custom property, so the animation can follow a slider, a scroll timeline or a video frame. Uncontrolled mode plays on its own and can loop.",
  },
  {
    q: 'Can I export a handwriting animation as a video, GIF or SVG?',
    a: 'Tegaki Studio exports PNG, GIF, WebM and animated SVG. For programmatic video, the Remotion integration renders handwriting frame by frame to MP4.',
  },
  {
    q: 'Is Tegaki free?',
    a: 'Yes. The library, the bundled fonts (each under its own open font license) and the Studio are free; the code is MIT licensed on GitHub.',
  },
];
