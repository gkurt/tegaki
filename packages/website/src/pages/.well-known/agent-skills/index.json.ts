import type { APIRoute } from 'astro';
import { agentSkillsIndex } from '../../../llms/content.ts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(agentSkillsIndex(), null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
