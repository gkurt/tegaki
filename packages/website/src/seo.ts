// Structured data (schema.org JSON-LD) and the <head> links every page shares.
// The home, studio and docs pages all describe the same entities, keyed by
// @id, so search engines and answer engines join them into one graph.

import {
  AUTHOR,
  CARD_IMAGE,
  DOC_SLUGS,
  FAQ,
  LOGO_IMAGE,
  NAME,
  NPM_URL,
  REPO_URL,
  SIDEBAR,
  SITE_URL,
  TAGLINE,
  TWITTER_URL,
} from './site.ts';

const ids = {
  website: `${SITE_URL}#website`,
  org: `${SITE_URL}#organization`,
  author: `${SITE_URL}#author`,
  software: `${SITE_URL}#software`,
  code: `${SITE_URL}#source-code`,
  studio: `${SITE_URL}studio/#app`,
};

/** A JSON-LD object as <script> text, safe to inline (no `</script>` break-outs). */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const author = {
  '@type': 'Person',
  '@id': ids.author,
  name: AUTHOR.name,
  url: AUTHOR.url,
  sameAs: AUTHOR.sameAs,
};

const organization = {
  '@type': 'Organization',
  '@id': ids.org,
  name: NAME,
  url: SITE_URL,
  logo: { '@type': 'ImageObject', url: LOGO_IMAGE, width: 180, height: 180 },
  description: TAGLINE,
  founder: { '@id': ids.author },
  sameAs: [REPO_URL, NPM_URL, TWITTER_URL],
};

const website = {
  '@type': 'WebSite',
  '@id': ids.website,
  name: NAME,
  alternateName: ['Tegaki handwriting animation', 'tegaki.js'],
  url: SITE_URL,
  description: TAGLINE,
  inLanguage: 'en',
  publisher: { '@id': ids.org },
};

const software = {
  '@type': 'SoftwareApplication',
  '@id': ids.software,
  name: NAME,
  description: TAGLINE,
  url: SITE_URL,
  image: CARD_IMAGE,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Handwriting animation library',
  operatingSystem: 'Any (web browser, Node.js)',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://opensource.org/licenses/MIT',
  downloadUrl: NPM_URL,
  installUrl: NPM_URL,
  softwareHelp: { '@type': 'CreativeWork', url: `${SITE_URL}getting-started/` },
  keywords:
    'handwriting animation, handwriting animation library, handwriting animation generator, animated handwriting, text writing animation, stroke order, signature animation, React, Svelte, Vue, SolidJS, Astro, Web Components, Remotion',
  featureList: [
    'Handwriting animation from any font, stroke by stroke in natural stroke order',
    'Adapters for React, Svelte, Vue, Nuxt, SolidJS, Astro, Web Components and vanilla JavaScript',
    'Video rendering with Remotion',
    'Latin, Hebrew, Arabic, Devanagari, Bengali, Japanese, Korean and Chinese',
    'Controlled, uncontrolled and CSS-driven timelines; streaming text',
    'Glow, wobble, pressure width, taper and gradient effects; plugin API',
    'Browser-based generator (Tegaki Studio) for custom font bundles',
  ],
  author: { '@id': ids.author },
  publisher: { '@id': ids.org },
};

const sourceCode = {
  '@type': 'SoftwareSourceCode',
  '@id': ids.code,
  name: `${NAME} source code`,
  codeRepository: REPO_URL,
  programmingLanguage: ['TypeScript', 'JavaScript'],
  runtimePlatform: 'Web browser',
  license: 'https://opensource.org/licenses/MIT',
  targetProduct: { '@id': ids.software },
  author: { '@id': ids.author },
};

/** The home page: the site, the project, the library, its source, and the FAQ shown on the page. */
export function homeJsonLd(title: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      organization,
      author,
      software,
      sourceCode,
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}#webpage`,
        url: SITE_URL,
        name: title,
        description,
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.software },
        primaryImageOfPage: { '@type': 'ImageObject', url: CARD_IMAGE, width: 1280, height: 640 },
        inLanguage: 'en',
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}#faq`,
        url: `${SITE_URL}#faq`,
        isPartOf: { '@id': ids.website },
        mainEntity: FAQ.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a.replace(/`/g, '') },
        })),
      },
    ],
  };
}

/** The studio: a free web app that generates handwriting animations. */
export function studioJsonLd(title: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': ids.studio,
        name: 'Tegaki Studio',
        alternateName: 'Tegaki handwriting animation generator',
        url: `${SITE_URL}studio/`,
        description,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires JavaScript and a modern browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: CARD_IMAGE,
        isPartOf: { '@id': ids.website },
        author: { '@id': ids.author },
        publisher: { '@id': ids.org },
      },
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}studio/#webpage`,
        url: `${SITE_URL}studio/`,
        name: title,
        description,
        isPartOf: { '@id': ids.website },
        mainEntity: { '@id': ids.studio },
        breadcrumb: breadcrumbs([{ name: 'Studio', url: `${SITE_URL}studio/` }]),
      },
    ],
  };
}

function breadcrumbs(trail: { name: string; url: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: NAME, url: SITE_URL }, ...trail].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/** A docs page: a TechArticle about the library, with its place in the sidebar as breadcrumbs. */
export function docJsonLd({ slug, title, description }: { slug: string; title: string; description: string }) {
  const url = `${SITE_URL}${slug}/`;
  const group = SIDEBAR.find((g) => g.items.some((item) => 'slug' in item && item.slug === slug));
  const firstInGroup = group?.items.find((item) => 'slug' in item);
  const trail = [
    ...(group && firstInGroup && 'slug' in firstInGroup && firstInGroup.slug !== slug
      ? [{ name: group.label, url: `${SITE_URL}${firstInGroup.slug}/` }]
      : []),
    { name: title, url },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: title,
    description,
    url,
    mainEntityOfPage: url,
    image: CARD_IMAGE,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', '@id': ids.website, name: NAME, url: SITE_URL },
    about: { '@type': 'SoftwareApplication', '@id': ids.software, name: NAME, url: SITE_URL, applicationCategory: 'DeveloperApplication' },
    author: { '@type': 'Person', '@id': ids.author, name: AUTHOR.name, url: AUTHOR.url },
    publisher: { '@type': 'Organization', '@id': ids.org, name: NAME, url: SITE_URL, logo: { '@type': 'ImageObject', url: LOGO_IMAGE } },
    proficiencyLevel: slug.startsWith('api/') ? 'Expert' : 'Beginner',
    ...(DOC_SLUGS.includes(slug) ? { breadcrumb: breadcrumbs(trail) } : {}),
  };
}

/**
 * <head> links on every page: the agent-facing files (llms.txt, llms-full.txt),
 * the sitemap (a single sitemap.xml, see singleSitemap in astro.config.ts), and
 * PNG icons next to the SVG favicon.
 */
export const SHARED_HEAD_LINKS: Record<string, string>[] = [
  { rel: 'alternate', type: 'text/plain', href: `${SITE_URL}llms.txt`, title: 'llms.txt' },
  { rel: 'alternate', type: 'text/plain', href: `${SITE_URL}llms-full.txt`, title: 'llms-full.txt' },
  { rel: 'describedby', type: 'text/plain', href: `${SITE_URL}llms.txt` },
  { rel: 'sitemap', href: `${SITE_URL}sitemap.xml` },
  { rel: 'icon', type: 'image/png', sizes: '180x180', href: `${SITE_URL}apple-touch-icon.png` },
  { rel: 'apple-touch-icon', href: `${SITE_URL}apple-touch-icon.png` },
];
