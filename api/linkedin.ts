import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorJson = (message: string, status = 400, extra?: Record<string, any>) =>
    json({ error: message, ...(extra || {}) }, status);

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn Configuration
// ─────────────────────────────────────────────────────────────────────────────

const getLinkedInConfig = () => {
    const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
    const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
    const redirectUri = (process.env.LINKEDIN_REDIRECT_URI || 'https://freshfront.co/linkedin/callback').trim();

    if (!clientId || !clientSecret) {
        throw new Error('LinkedIn credentials not configured. Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables.');
    }

    return { clientId, clientSecret, redirectUri };
};

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn API Helper
// ─────────────────────────────────────────────────────────────────────────────

const linkedinFetch = async <T>(
    url: string,
    options: {
        method?: string;
        accessToken?: string;
        body?: any;
        formData?: Record<string, string>;
        headers?: Record<string, string>;
    }
): Promise<T> => {
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
        'X-Restli-Protocol-Version': '2.0.0',
        ...options.headers,
    };

    let bodyContent: any;

    if (options.formData) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        bodyContent = new URLSearchParams(options.formData).toString();
    } else if (options.body) {
        if (options.body instanceof ArrayBuffer || Buffer.isBuffer(options.body)) {
            bodyContent = options.body;
            // Content-Type should be set by caller for binary data
        } else {
            headers['Content-Type'] = 'application/json';
            bodyContent = JSON.stringify(options.body);
        }
    }

    if (options.accessToken) {
        headers['Authorization'] = `Bearer ${options.accessToken}`;
    }

    const res = await fetch(url, {
        method,
        headers,
        body: bodyContent,
    });

    const text = await res.text();
    let data: any = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        if (!res.ok) {
            throw new Error(`LinkedIn API error (${res.status}): ${text.substring(0, 300)}`);
        }
        return {} as T;
    }

    if (!res.ok) {
        const errorMsg = data?.message || data?.error_description || data?.error || `LinkedIn API request failed (${res.status})`;
        throw new Error(errorMsg);
    }

    return data as T;
};

// ─────────────────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────────────────

const getStoredTokens = async (uid: string) => {
    const db = getFirestore();
    const ref = db.doc(`users/${uid}/integrations/linkedin`);
    const snap = await ref.get();
    return snap.exists ? snap.data() : null;
};

const saveTokens = async (uid: string, data: Record<string, any>) => {
    const db = getFirestore();
    const ref = db.doc(`users/${uid}/integrations/linkedin`);
    await ref.set({ ...data, updatedAt: Date.now() }, { merge: true });
};

const getValidAccessToken = async (uid: string): Promise<{ accessToken: string; personUrn: string }> => {
    const tokens = await getStoredTokens(uid);
    if (!tokens?.refreshToken) {
        throw new Error('LinkedIn not connected');
    }

    // Check if access token is still valid (with 60s buffer)
    if (tokens.accessToken && tokens.accessTokenExpiresAt && Date.now() < tokens.accessTokenExpiresAt - 60000) {
        return { accessToken: tokens.accessToken, personUrn: tokens.personUrn };
    }

    // Refresh the token
    const { clientId, clientSecret } = getLinkedInConfig();

    const refreshData = await linkedinFetch<any>('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        formData: {
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        },
    });

    const newAccessToken = refreshData.access_token;
    const expiresIn = refreshData.expires_in || 3600;

    await saveTokens(uid, {
        accessToken: newAccessToken,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
        refreshToken: refreshData.refresh_token || tokens.refreshToken,
        refreshTokenExpiresAt: refreshData.refresh_token_expires_in
            ? Date.now() + refreshData.refresh_token_expires_in * 1000
            : tokens.refreshTokenExpiresAt,
    });

    return { accessToken: newAccessToken, personUrn: tokens.personUrn };
};

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Handlers
// ─────────────────────────────────────────────────────────────────────────────

const handleAuthUrl = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { clientId, redirectUri } = getLinkedInConfig();

    const url = new URL(request.url);
    const returnTo = url.searchParams.get('returnTo') || '/';

    const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');

    const oauthUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('client_id', clientId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('scope', 'openid profile email w_member_social');

    return json({ url: oauthUrl.toString() });
};

const handleExchange = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    let body: { code?: string };
    try {
        body = await request.json();
    } catch {
        return errorJson('Invalid JSON body', 400);
    }

    const code = (body.code || '').trim();
    if (!code) return errorJson('Missing code', 400);

    const { clientId, clientSecret, redirectUri } = getLinkedInConfig();

    // Exchange code for tokens
    const tokenData = await linkedinFetch<any>('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        formData: {
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        },
    });

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || '';
    const expiresIn = tokenData.expires_in || 3600;
    const refreshExpiresIn = tokenData.refresh_token_expires_in || 31536000; // Default 1 year
    const scope = tokenData.scope || '';

    if (!accessToken) {
        return errorJson('Token exchange returned no access_token', 500);
    }

    // Fetch user profile using OIDC userinfo endpoint
    const userInfo = await linkedinFetch<any>('https://api.linkedin.com/v2/userinfo', {
        accessToken,
    });

    const personUrn = userInfo.sub;
    const profileName = userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`.trim();
    const profilePicture = userInfo.picture || '';

    await saveTokens(authResult.uid, {
        provider: 'linkedin',
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
        refreshTokenExpiresAt: Date.now() + refreshExpiresIn * 1000,
        scope,
        personUrn,
        profileName,
        profilePicture,
    });

    return json({ connected: true, profile: { personUrn, name: profileName, picture: profilePicture } });
};

const handleStatus = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    try {
        const tokens = await getStoredTokens(authResult.uid);
        if (!tokens?.refreshToken) {
            return json({ connected: false });
        }

        return json({
            connected: true,
            profile: {
                personUrn: tokens.personUrn,
                name: tokens.profileName,
                picture: tokens.profilePicture,
            },
        });
    } catch (e: any) {
        if (e.message === 'LinkedIn not connected') {
            return json({ connected: false });
        }
        throw e;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Posting Handlers
// ─────────────────────────────────────────────────────────────────────────────

const handlePostText = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    let body: { text?: string; visibility?: 'PUBLIC' | 'CONNECTIONS' };
    try {
        body = await request.json();
    } catch {
        return errorJson('Invalid JSON body', 400);
    }

    const text = (body.text || '').trim();
    if (!text) return errorJson('Missing text', 400);

    const { accessToken, personUrn } = await getValidAccessToken(authResult.uid);

    const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'NONE',
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
    };

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
    });

    if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
    }

    const postId = res.headers.get('X-RestLi-Id') || '';
    return json({ success: true, postId });
};

const handlePostArticle = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    let body: {
        text?: string;
        articleUrl?: string;
        articleTitle?: string;
        articleDescription?: string;
        visibility?: 'PUBLIC' | 'CONNECTIONS';
    };
    try {
        body = await request.json();
    } catch {
        return errorJson('Invalid JSON body', 400);
    }

    const articleUrl = (body.articleUrl || '').trim();
    if (!articleUrl) return errorJson('Missing articleUrl', 400);

    const { accessToken, personUrn } = await getValidAccessToken(authResult.uid);

    const media: any = {
        status: 'READY',
        originalUrl: articleUrl,
    };

    if (body.articleTitle) {
        media.title = { text: body.articleTitle };
    }
    if (body.articleDescription) {
        media.description = { text: body.articleDescription };
    }

    const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: body.text || '' },
                shareMediaCategory: 'ARTICLE',
                media: [media],
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
    };

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
    });

    if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
    }

    const postId = res.headers.get('X-RestLi-Id') || '';
    return json({ success: true, postId });
};

const handleRegisterUpload = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    let body: { mediaType?: 'IMAGE' | 'VIDEO' };
    try {
        body = await request.json();
    } catch {
        return errorJson('Invalid JSON body', 400);
    }

    const mediaType = body.mediaType || 'IMAGE';
    const { accessToken, personUrn } = await getValidAccessToken(authResult.uid);

    const recipe = mediaType === 'VIDEO' ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';

    const registerData = {
        registerUploadRequest: {
            recipes: [recipe],
            owner: `urn:li:person:${personUrn}`,
            serviceRelationships: [
                {
                    relationshipType: 'OWNER',
                    identifier: 'urn:li:userGeneratedContent',
                },
            ],
        },
    };

    const res = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(registerData),
    });

    if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to register upload: ${res.status} ${errText}`, res.status);
    }

    const data = await res.json();
    const uploadUrl = data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    const asset = data?.value?.asset;

    if (!uploadUrl || !asset) {
        return errorJson('Failed to get upload URL from LinkedIn', 500);
    }

    return json({ uploadUrl, asset });
};

const handleUploadMedia = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    // Get the upload URL from query params
    const url = new URL(request.url);
    const uploadUrl = url.searchParams.get('uploadUrl');
    if (!uploadUrl) return errorJson('Missing uploadUrl parameter', 400);

    // Get valid access token
    const { accessToken } = await getValidAccessToken(authResult.uid);

    // Get the binary body from the request
    const body = await request.arrayBuffer();
    if (!body || body.byteLength === 0) {
        return errorJson('Missing file body', 400);
    }

    // Get content type from request headers
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

    // Upload to LinkedIn using PUT method as per documentation
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': contentType,
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: body,
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return errorJson(`Failed to upload media to LinkedIn: ${uploadRes.status} ${errText}`, uploadRes.status);
    }

    return json({ success: true });
};

const handlePostMedia = async (request: Request): Promise<Response> => {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    let body: {
        text?: string;
        asset?: string;
        mediaType?: 'IMAGE' | 'VIDEO';
        mediaTitle?: string;
        mediaDescription?: string;
        visibility?: 'PUBLIC' | 'CONNECTIONS';
    };
    try {
        body = await request.json();
    } catch {
        return errorJson('Invalid JSON body', 400);
    }

    const asset = (body.asset || '').trim();
    if (!asset) return errorJson('Missing asset URN', 400);

    const { accessToken, personUrn } = await getValidAccessToken(authResult.uid);

    const mediaCategory = body.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE';

    const media: any = {
        status: 'READY',
        media: asset,
    };

    if (body.mediaTitle) {
        media.title = { text: body.mediaTitle };
    }
    if (body.mediaDescription) {
        media.description = { text: body.mediaDescription };
    }

    const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: body.text || '' },
                shareMediaCategory: mediaCategory,
                media: [media],
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
    };

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
    });

    if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
    }

    const postId = res.headers.get('X-RestLi-Id') || '';
    return json({ success: true, postId });
};

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const handleDisconnect = async (request: Request): Promise<Response> => {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    try {
        const db = getFirestore();
        await db.doc(`users/${auth.uid}/integrations/linkedin`).delete();
        return json({ success: true });
    } catch (e: any) {
        return errorJson(`Disconnect failed: ${e.message}`, 500);
    }
};

const HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
    'auth-url': handleAuthUrl,
    'exchange': handleExchange,
    'status': handleStatus,
    'post-text': handlePostText,
    'post-article': handlePostArticle,
    'register-upload': handleRegisterUpload,
    'upload-media': handleUploadMedia,
    'post-media': handlePostMedia,
    'disconnect': handleDisconnect,
};

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const op = (url.searchParams.get('op') || '').trim();

        if (!op) return errorJson('Missing op parameter', 400);

        const handler = HANDLERS[op];
        if (!handler) return errorJson(`Unknown operation: ${op}`, 404);

        try {
            return await handler(request);
        } catch (e: any) {
            console.error(`LinkedIn API error (${op}):`, e);
            return errorJson(e?.message || 'Internal error', 500);
        }
    },
};
