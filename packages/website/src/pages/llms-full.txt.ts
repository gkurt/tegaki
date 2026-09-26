import type { APIRoute } from 'astro';
import { llmsFullTxt } from '../llms/content.ts';
import { loadDocs, textResponse } from '../llms/load.ts';

export const GET: APIRoute = async () => textResponse(llmsFullTxt(await loadDocs()));
