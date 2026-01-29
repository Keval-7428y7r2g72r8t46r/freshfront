import * as pexelsImage from '../api-legacy/pexels-image.js';
import * as geminiImage from '../api-legacy/gemini-image.js';
import * as soraVideo from '../api-legacy/sora-video.js';
import * as creatomate from '../api-legacy/creatomate.js';
import * as videoOverview from '../api-legacy/video-overview.js';
import * as youtubeVideoAnalysis from '../api-legacy/youtube-video-analysis.js';

// Privacy operations (consolidated from privacy.ts)
import * as accountDelete from '../api-legacy/account-delete.js';
import * as dataDeletionCallback from '../api-legacy/data-deletion-callback.js';
import * as dataDeletionStatus from '../api-legacy/data-deletion-status.js';

import { put, del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

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

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

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
  // Media operations
  'pexels-image': pexelsImage,
  'gemini-image': geminiImage,
  'sora-video': soraVideo,
  'creatomate-video': { fetch: (req: Request) => req.json().then(body => creatomate.handleVoiceoverVideo(body)) } as any,
  'creatomate-overview-video': { fetch: (req: Request) => req.json().then(body => creatomate.handleOverviewVideo(body)) } as any,
  'creatomate-slideshow': { fetch: (req: Request) => req.json().then(body => creatomate.handleSlideshowVideo(body)) } as any,
  'video-overview': videoOverview,
  'youtube-video-analysis': youtubeVideoAnalysis,
  // Privacy operations (consolidated from privacy.ts)
  'account-delete': accountDelete,
  'data-deletion-callback': dataDeletionCallback,
  'data-deletion-status': dataDeletionStatus,
};

const getBlobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env.researcher_READ_WRITE_TOKEN ||
  undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return error('Missing op', 400);

    // New Blob/Media Operations (Merged from api/blob.ts and api/blob/upload.ts)
    try {
      if (op === 'upload-token') {
        if (request.method !== 'POST') return error('Method not allowed', 405);

        const body = (await request.json()) as HandleUploadBody;
        const token = getBlobToken();

        console.log('[Media API] Handle Upload Token Request');
        console.log('[Media API] BLOB_READ_WRITE_TOKEN present:', !!process.env.BLOB_READ_WRITE_TOKEN);
        console.log('[Media API] researcher_READ_WRITE_TOKEN present:', !!process.env.researcher_READ_WRITE_TOKEN);

        if (token) {
          console.log('[Media API] Token being used (first 8 chars):', token.substring(0, 8) + '...');
        } else {
          console.error('[Media API] NO TOKEN FOUND in environment variables');
        }

        try {
          const jsonResponse = await handleUpload({
            body,
            request,
            token,
            onBeforeGenerateToken: async (pathname) => {
              return {
                allowedContentTypes: [
                  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/ogg',
                  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac',
                  // Documents
                  'application/pdf', 'text/csv', 'text/plain', 'text/markdown',
                  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ],
                addRandomSuffix: true,
              };
            },
            onUploadCompleted: async ({ blob }) => {
              console.log('[Media API] Blob upload completed:', blob.url);
            },
          });
          return json(jsonResponse);
        } catch (e: any) {
          console.error('[Media API] handleUpload error:', e);
          return error(e.message || 'Failed to handle upload token', 500, { error: e.message });
        }
      }

      if (op === 'upload-blob') {
        if (request.method !== 'POST') return error('Method not allowed', 405);

        const projectId = url.searchParams.get('projectId') || 'unknown-project';
        const filename = url.searchParams.get('filename') || 'file';
        const contentType = url.searchParams.get('contentType') || 'application/octet-stream';

        const arrayBuffer = await request.arrayBuffer();
        const data = new Blob([arrayBuffer], { type: contentType });

        const pathname = `projects/${projectId}/${filename}`;
        const token = getBlobToken();

        const stored = await put(pathname, data, {
          access: 'public',
          addRandomSuffix: true,
          token,
        });

        return json(stored);
      }

      if (op === 'delete-blob') {
        if (request.method !== 'POST') return error('Method not allowed', 405);
        const body = await request.json().catch(() => ({}));
        const pathname = (body?.pathname || '').toString();

        if (!pathname) return error('Missing pathname', 400);

        const token = getBlobToken();
        await del(pathname, { token });

        return json({ success: true });
      }

    } catch (e: any) {
      console.error('[Media API] Blob operation failed:', e);
      return error(e?.message || 'Blob operation failed', 500);
    }

    // Proxy Image Operation
    if (op === 'proxy-image') {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl) return error('Missing url parameter', 400);

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          return error(`Failed to fetch image: ${response.status}`, response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        // CORS Headers handled by Vercel usually, but explicit headers for the image response:
        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        };

        return new Response(buffer, { status: 200, headers });
      } catch (e: any) {
        console.error('[Media API] Proxy image failed:', e);
        return error('Failed to proxy image', 500);
      }
    }

    // Luma Proxy Operations
    if (op === 'luma-modify') {
      if (request.method !== 'POST') return error('Method not allowed', 405);
      const apiKey = process.env.VITE_LUMA_API_KEY;
      if (!apiKey) return error('Server configuration error: Missing Luma API Key', 500);

      try {
        const body = await request.json();
        const response = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations/video/modify', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();
        return json(data, response.status);
      } catch (e: any) {
        console.error('[Media API] Luma modify failed:', e);
        return error(e?.message || 'Luma modify failed', 500);
      }
    }

    if (op === 'luma-get-generation') {
      const id = url.searchParams.get('id');
      if (!id) return error('Missing id', 400);

      const apiKey = process.env.VITE_LUMA_API_KEY;
      if (!apiKey) return error('Server configuration error: Missing Luma API Key', 500);

      try {
        const response = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        });

        const data = await response.json();
        return json(data, response.status);
      } catch (e: any) {
        console.error('[Media API] Luma get generation failed:', e);
        return error(e?.message || 'Luma get generation failed', 500);
      }
    }

    // Legacy Modules
    const mod = ALLOWED[op];
    if (!mod) return error('Not found', 404);

    try {
      return await callLegacyModule(mod, request);
    } catch (e: any) {
      return error(e?.message || 'Internal error', 500);
    }
  },
};
