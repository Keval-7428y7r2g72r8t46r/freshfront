import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';
import * as googleCalendarEventDelete from '../api-legacy/google-calendar-event-delete.js';
import * as googleCalendarEventUpsert from '../api-legacy/google-calendar-event-upsert.js';
import * as googleCalendarEvents from '../api-legacy/google-calendar-events.js';
import * as googleCalendarStatus from '../api-legacy/google-calendar-status.js';
import * as googleDocsGet from '../api-legacy/google-docs-get.js';
import * as googleDocsUpdate from '../api-legacy/google-docs-update.js';
import * as googleDriveFiles from '../api-legacy/google-drive-files.js';
import * as googleDriveImport from '../api-legacy/google-drive-import.js';
import * as googleSheetsCreate from '../api-legacy/google-sheets-create.js';
import * as googleSheetsMetadata from '../api-legacy/google-sheets-metadata.js';
import * as googleSheetsValuesClear from '../api-legacy/google-sheets-values-clear.js';
import * as googleSheetsValuesGet from '../api-legacy/google-sheets-values-get.js';
import * as googleSheetsValuesUpdate from '../api-legacy/google-sheets-values-update.js';
import * as youtubeUploadInit from '../api-legacy/youtube-upload-init.js';
import * as youtubeSearch from '../api-legacy/youtube-search.js';

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

const base64UrlEncode = (input: string): string => {
  const b64 = Buffer.from(input, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const getRedirectUri = (request: Request, provider: 'googleDrive' | 'youtube'): string => {
  const url = new URL(request.url);
  if (provider === 'youtube') {
    const explicit = (process.env.YOUTUBE_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    // Fallback to Drive if configured (common for shared projects) or default
    const driveRedirect = (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
    if (driveRedirect) return driveRedirect;
    return `${url.origin}/youtube/callback`;
  } else {
    const explicit = (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    return `${url.origin}/google-drive/callback`;
  }
};

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
  'google-calendar-event-delete': googleCalendarEventDelete,
  'google-calendar-event-upsert': googleCalendarEventUpsert,
  'google-calendar-events': googleCalendarEvents,
  'google-calendar-status': googleCalendarStatus, // Keep for now or replace? Plan said consolidate. Let's replace.
  'google-docs-get': googleDocsGet,
  'google-docs-update': googleDocsUpdate,
  'google-drive-files': googleDriveFiles,
  'google-drive-import': googleDriveImport,
  'google-sheets-create': googleSheetsCreate,
  'google-sheets-metadata': googleSheetsMetadata,
  'google-sheets-values-clear': googleSheetsValuesClear,
  'google-sheets-values-get': googleSheetsValuesGet,
  'google-sheets-values-update': googleSheetsValuesUpdate,
  'youtube-upload-init': youtubeUploadInit,
  'youtube-search': youtubeSearch,
  'google-disconnect': {
    default: async (request: Request) => {
      const authResult = await (requireAuth as any)(request);
      if (authResult instanceof Response) return authResult;
      const db = getFirestore();
      // Delete both youtube and googleDrive if they exist
      await db.doc(`users/${authResult.uid}/integrations/youtube`).delete();
      await db.doc(`users/${authResult.uid}/integrations/googleDrive`).delete();
      return json({ success: true });
    }
  }
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return error('Missing op', 400);

    // -----------------------------------------------------------------------
    // NEW CONSOLIDATED AUTH FLOWS
    // -----------------------------------------------------------------------

    // 1. Auth URL
    if (op === 'google-drive-auth-url' || op === 'youtube-auth-url') {
      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;

      const isYoutube = op === 'youtube-auth-url';

      const clientId = isYoutube
        ? (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim()
        : (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();

      if (!clientId) {
        return error(`Missing ${isYoutube ? 'YOUTUBE' : 'GOOGLE_DRIVE'}_CLIENT_ID`, 500);
      }

      const returnTo = (url.searchParams.get('returnTo') || '/').trim();
      const redirectUri = getRedirectUri(request, isYoutube ? 'youtube' : 'googleDrive');

      const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      oauthUrl.searchParams.set('client_id', clientId);
      oauthUrl.searchParams.set('redirect_uri', redirectUri);
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('access_type', 'offline');
      oauthUrl.searchParams.set('prompt', 'consent');
      oauthUrl.searchParams.set('include_granted_scopes', 'true');
      oauthUrl.searchParams.set('state', base64UrlEncode(JSON.stringify({ returnTo })));

      if (isYoutube) {
        oauthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
      } else {
        oauthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/calendar');
      }

      return json({ url: oauthUrl.toString() });
    }

    // 2. Exchange Code
    if (op === 'google-drive-exchange' || op === 'youtube-exchange') {
      if (request.method !== 'POST') return error('Method not allowed', 405);

      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;
      const { uid } = authResult;

      const body = await request.json().catch(() => ({}));
      const code = (body.code || '').trim();
      if (!code) return error('Missing code', 400);

      const isYoutube = op === 'youtube-exchange';
      const clientId = isYoutube
        ? (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim()
        : (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
      const clientSecret = isYoutube
        ? (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim()
        : (process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

      if (!clientId || !clientSecret) return error('Missing Client ID/Secret', 500);

      const redirectUri = getRedirectUri(request, isYoutube ? 'youtube' : 'googleDrive');

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        return error(`Token exchange failed: ${tokenRes.status}`, 400, await tokenRes.text());
      }

      const tokenJson: any = await tokenRes.json();
      const db = getFirestore();
      const docRef = db.doc(`users/${uid}/integrations/${isYoutube ? 'youtube' : 'googleDrive'}`);

      // FIX: Preserving Refresh Token if missing
      if (!tokenJson.refresh_token) {
        const existing = await docRef.get();
        if (existing.exists && existing.data()?.refreshToken) {
          tokenJson.refresh_token = existing.data()?.refreshToken;
        } else if (isYoutube) {
          // Youtube specific fallback: try Google Drive's token? 
          // Legacy logic didn't explicit do this, but they often share projects.
          // Let's stick to safe "preserve existing" first.
        }
      }

      const updateData: any = {
        provider: isYoutube ? 'youtube' : 'googleDrive',
        accessToken: tokenJson.access_token,
        accessTokenExpiresAt: Date.now() + (Number(tokenJson.expires_in || 0) * 1000),
        scope: tokenJson.scope,
        tokenType: tokenJson.token_type,
        updatedAt: Date.now(),
      };

      if (tokenJson.refresh_token) {
        updateData.refreshToken = tokenJson.refresh_token;
      }

      await docRef.set(updateData, { merge: true });
      return json({ connected: Boolean(updateData.refreshToken) });
    }

    // 3. Status
    if (op === 'google-drive-status' || op === 'youtube-status' || op === 'google-calendar-status') {
      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;
      const { uid } = authResult;
      const db = getFirestore();

      if (op === 'youtube-status') {
        const doc = await db.doc(`users/${uid}/integrations/youtube`).get();
        return json({
          connected: doc.exists && !!doc.data()?.refreshToken,
          scope: doc.exists ? doc.data()?.scope : ''
        });
      }

      // Drive & Calendar use the 'googleDrive' integration doc
      const doc = await db.doc(`users/${uid}/integrations/googleDrive`).get();
      if (!doc.exists) return json({ connected: false });

      const data = doc.data() || {};
      const connected = !!data.refreshToken;
      const scope = String(data.scope || '');

      if (op === 'google-calendar-status') {
        return json({
          connected: connected && scope.includes('https://www.googleapis.com/auth/calendar'),
          scope
        });
      }

      return json({ connected, scope });
    }

    // -----------------------------------------------------------------------
    // LEGACY FALLBACK
    // -----------------------------------------------------------------------
    const mod = ALLOWED[op];
    if (!mod) return error('Not found', 404);

    try {
      return await callLegacyModule(mod, request);
    } catch (e: any) {
      console.error('[Google API] Error calling legacy module:', e);
      return error(e?.message || 'Internal error', 500);
    }
  },
};
