import { getCollection } from 'astro:content';
import type { DocPage } from './content.ts';

/** Every docs page, as the agent-facing files read it. */
export async function loadDocs(): Promise<DocPage[]> {
  const entries = await getCollection('docs');
  return entries.map((entry) => ({
    slug: entry.id,
    title: entry.data.title,
    description: entry.data.description ?? '',
    body: entry.body ?? '',
  }));
}

export const markdownResponse = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
export const textResponse = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
