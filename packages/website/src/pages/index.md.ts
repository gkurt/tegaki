import type { APIRoute } from 'astro';
import { homeMarkdown } from '../llms/content.ts';
import { markdownResponse } from '../llms/load.ts';

export const GET: APIRoute = () => markdownResponse(homeMarkdown());
