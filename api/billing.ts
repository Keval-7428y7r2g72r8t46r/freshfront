import * as checkSubscription from '../api-legacy/check-subscription.js';
import * as createCheckoutSession from '../api-legacy/create-checkout-session.js';
import * as webhook from '../api-legacy/webhook.js';

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
  'check-subscription': checkSubscription,
  'create-checkout-session': createCheckoutSession,
  'webhook': webhook,
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
