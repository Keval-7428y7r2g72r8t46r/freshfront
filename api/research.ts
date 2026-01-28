import * as deepResearch from '../api-legacy/deep-research.js';
import * as newsSearch from '../api-legacy/news-search.js';
import * as braveSearch from '../api-legacy/brave-search.js';
import * as wizaCompanyEnrichTable from '../api-legacy/wiza-company-enrich-table.js';
import * as wizaGenerateTable from '../api-legacy/wiza-generate-table.js';
import * as wizaProspectSearch from '../api-legacy/wiza-prospect-search.js';
import * as computerUse from '../api-legacy/computer-use.js';
import * as computerUseV2 from '../api-legacy/computer-use-v2.js';
import * as leadSearch from '../api-legacy/lead-search.js';

type LegacyModule = {
  default?: { fetch?: (request: Request) => Promise<Response> | Response } | ((request: Request) => Promise<Response> | Response);
  fetch?: (request: Request) => Promise<Response> | Response;
  GET?: (request: Request) => Promise<Response> | Response;
  POST?: (request: Request) => Promise<Response> | Response;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400) => json({ error: message }, status);

const callLegacyModule = async (mod: LegacyModule, request: Request): Promise<Response> => {
  const handler =
    (mod?.default as any)?.fetch ||
    (typeof mod?.default === 'function' ? (mod.default as any) : null) ||
    mod?.fetch ||
    (request.method === 'GET' ? mod?.GET : null) ||
    (request.method === 'POST' ? mod?.POST : null);

  if (typeof handler !== 'function') {
    throw new Error('Legacy handler missing');
  }

  return await handler(request);
};

const ALLOWED: Record<string, LegacyModule> = {
  'deep-research': deepResearch,
  'news-search': newsSearch,
  'brave-search': braveSearch,
  'wiza-company-enrich-table': wizaCompanyEnrichTable,
  'wiza-generate-table': wizaGenerateTable,
  'wiza-prospect-search': wizaProspectSearch,
  'computer-use': computerUse,
  'computer-use-v2': computerUseV2,
  'lead-search': leadSearch,
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return error('Missing op', 400);

    const mod = ALLOWED[op];
    if (!mod) return error('Not found', 404);

    try {
      return await callLegacyModule(mod, request);
    } catch (e: any) {
      return error(e?.message || 'Internal error', 500);
    }
  },
};
