import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { docJsonLd, jsonLdString } from './seo.ts';
import { SITE_URL } from './site.ts';

// Adds to every docs page's <head>: a link to its Markdown mirror (from
// src/pages/[...slug].md.ts) for agents, and TechArticle + BreadcrumbList JSON-LD.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const { entry } = route;
  if (entry.id === '404') return;

  route.head.push(
    { tag: 'link', attrs: { rel: 'alternate', type: 'text/markdown', href: `${SITE_URL}${entry.id}.md`, title: 'This page as Markdown' } },
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: jsonLdString(docJsonLd({ slug: entry.id, title: entry.data.title, description: entry.data.description ?? '' })),
    },
  );
});
