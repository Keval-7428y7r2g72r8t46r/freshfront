import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400) => json({ error: message }, status);

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return error('Method not allowed', 405);
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const db = getFirestore();
    const ref = db.doc(`users/${authResult.uid}/integrations/googleDrive`);
    const snap = await ref.get().catch(() => null);
    const data = snap?.data();
    const refreshToken = snap?.exists ? String(data?.refreshToken || '') : '';
    const scope = snap?.exists ? String(data?.scope || '') : '';
    const hasDriveScope = scope.includes('https://www.googleapis.com/auth/drive.readonly') || scope.includes('https://www.googleapis.com/auth/drive');
    const hasSheetsScope = scope.includes('https://www.googleapis.com/auth/spreadsheets');
    const hasDocsScope = scope.includes('https://www.googleapis.com/auth/documents');

    return json({
      connected: Boolean(refreshToken) && hasDriveScope,
      sheetsConnected: Boolean(refreshToken) && hasSheetsScope,
      docsConnected: Boolean(refreshToken) && hasDocsScope,
      scope
    }, 200);
  },
};
