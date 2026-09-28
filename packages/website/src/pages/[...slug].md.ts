import type { APIRoute, GetStaticPaths } from 'astro';
import { type DocPage, docMarkdown } from '../llms/content.ts';
import { loadDocs, markdownResponse } from '../llms/load.ts';

// Every docs page as Markdown next to its HTML: /guides/streaming/ → /guides/streaming.md
export const getStaticPaths = (async () =>
  (await loadDocs()).map((doc) => ({ params: { slug: doc.slug }, props: { doc } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ doc: DocPage }> = ({ props }) => markdownResponse(docMarkdown(props.doc));
