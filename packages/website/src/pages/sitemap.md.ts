import type { APIRoute } from 'astro';
import { sitemapMd } from '../llms/content.ts';
import { loadDocs, markdownResponse } from '../llms/load.ts';

export const GET: APIRoute = async () => markdownResponse(sitemapMd(await loadDocs()));
