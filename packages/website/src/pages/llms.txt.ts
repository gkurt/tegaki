import type { APIRoute } from 'astro';
import { llmsTxt } from '../llms/content.ts';
import { loadDocs, textResponse } from '../llms/load.ts';

export const GET: APIRoute = async () => textResponse(llmsTxt(await loadDocs()));
