import { requireAuth } from './_auth.js';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// --- Firebase Initialization ---

let firebaseInitialized = false;

const ensureFirebaseInitialized = async () => {
    if (firebaseInitialized) return;

    if (getApps().length === 0) {
        const projectId = process.env.FIREBASE_PROJECT_ID || 'ffresearchr';
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

        if (clientEmail && privateKey) {
            initializeApp({
                credential: cert({ projectId, clientEmail, privateKey }),
            });
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
            const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            initializeApp({
                credential: cert({
                    projectId: parsed.project_id || projectId,
                    clientEmail: parsed.client_email,
                    privateKey: (parsed.private_key || '').replace(/\\n/g, '\n'),
                }),
            });
        } else {
            throw new Error('Missing Firebase credentials for TikTok API');
        }
    }

    firebaseInitialized = true;
};

// Fetch stored TikTok tokens from Firestore
const getStoredTikTokData = async (uid: string) => {
    await ensureFirebaseInitialized();
    const db = getFirestore();
    const doc = await db.doc(`users/${uid}/integrations/tiktok`).get();
    return doc.exists ? (doc.data() as any) : null;
};

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorJson = (message: string, status = 400, extra?: Record<string, any>) =>
    json({ error: message, ...(extra || {}) }, status);

const getTikTokConfig = () => {
    const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || '';

    if (!clientKey || !clientSecret || !redirectUri) {
        throw new Error('TikTok credentials not configured. Please set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI environment variables.');
    }

    return { clientKey, clientSecret, redirectUri };
};

// Helper to make TikTok API requests
const tiktokFetch = async <T>(
    url: string,
    options: {
        method?: string;
        accessToken?: string;
        body?: any;
        formData?: Record<string, string>;
    }
): Promise<T> => {
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
        'Cache-Control': 'no-cache'
    };

    let bodyContent: string | undefined;

    if (options.formData) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        bodyContent = new URLSearchParams(options.formData).toString();
    } else if (options.body) {
        headers['Content-Type'] = 'application/json; charset=UTF-8';
        bodyContent = JSON.stringify(options.body);
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
    } catch (parseError) {
        throw new Error(`Failed to parse TikTok API response: ${text.substring(0, 200)}`);
    }

    // TikTok API returns error object even for successful responses
    // Check if error.code !== "ok" to determine if it's an actual error
    if (data?.error && data.error.code && data.error.code !== 'ok') {
        const errorMsg = data.error.message || data.error.code || 'TikTok API error';
        const logId = data.error.log_id ? ` (log_id: ${data.error.log_id})` : '';
        throw new Error(errorMsg + logId);
    }

    // Handle OAuth errors (different format)
    if (data?.error && typeof data.error === 'string') {
        const errorMsg = data.error_description || data.error;
        const logId = data.log_id ? ` (log_id: ${data.log_id})` : '';
        throw new Error(errorMsg + logId);
    }

    if (!res.ok) {
        const errorMsg = data?.error?.message
            || data?.message
            || `TikTok API request failed (${res.status}): ${text.substring(0, 200)}`;
        throw new Error(errorMsg);
    }

    return data as T;
};

// Generate OAuth authorization URL
const generateAuthUrl = (state: string): string => {
    const { clientKey, redirectUri } = getTikTokConfig();

    const params = new URLSearchParams({
        client_key: clientKey,
        scope: 'user.info.basic,video.publish,video.upload',
        response_type: 'code',
        redirect_uri: redirectUri,
        state: state,
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
};

// Exchange authorization code for tokens
const exchangeCodeForToken = async (code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    openId: string;
    expiresIn: number;
    refreshExpiresIn: number;
    scope: string;
}> => {
    const { clientKey, clientSecret, redirectUri } = getTikTokConfig();

    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        formData: {
            client_key: clientKey,
            client_secret: clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        },
    });

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        openId: data.open_id,
        expiresIn: data.expires_in,
        refreshExpiresIn: data.refresh_expires_in,
        scope: data.scope,
    };
};

// Refresh access token
const refreshAccessToken = async (refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    openId: string;
    expiresIn: number;
    refreshExpiresIn: number;
    scope: string;
}> => {
    const { clientKey, clientSecret } = getTikTokConfig();

    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        formData: {
            client_key: clientKey,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        },
    });

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        openId: data.open_id,
        expiresIn: data.expires_in,
        refreshExpiresIn: data.refresh_expires_in,
        scope: data.scope,
    };
};

// Revoke access
const revokeAccess = async (accessToken: string): Promise<void> => {
    const { clientKey, clientSecret } = getTikTokConfig();

    await tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/revoke/', {
        method: 'POST',
        formData: {
            client_key: clientKey,
            client_secret: clientSecret,
            token: accessToken,
        },
    });
};

// Query creator info
const queryCreatorInfo = async (accessToken: string): Promise<{
    creatorAvatarUrl: string;
    creatorUsername: string;
    creatorNickname: string;
    privacyLevelOptions: string[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
    maxVideoPostDurationSec: number;
}> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
        method: 'POST',
        accessToken,
    });

    const d = data.data || {};
    return {
        creatorAvatarUrl: d.creator_avatar_url || '',
        creatorUsername: d.creator_username || '',
        creatorNickname: d.creator_nickname || '',
        privacyLevelOptions: d.privacy_level_options || [],
        commentDisabled: !!d.comment_disabled,
        duetDisabled: !!d.duet_disabled,
        stitchDisabled: !!d.stitch_disabled,
        maxVideoPostDurationSec: d.max_video_post_duration_sec || 60,
    };
};

// Post video using PULL_FROM_URL
const postVideo = async (params: {
    accessToken: string;
    videoUrl: string;
    title?: string;
    privacyLevel: string;
    disableDuet?: boolean;
    disableStitch?: boolean;
    disableComment?: boolean;
    videoCoverTimestampMs?: number;
}): Promise<{ publishId: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                privacy_level: params.privacyLevel,
                disable_duet: params.disableDuet ?? false,
                disable_stitch: params.disableStitch ?? false,
                disable_comment: params.disableComment ?? false,
                video_cover_timestamp_ms: params.videoCoverTimestampMs ?? 1000,
            },
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: params.videoUrl,
            },
        },
    });

    return { publishId: data.data?.publish_id || '' };
};

// Initiate video upload using FILE_UPLOAD (to inbox/draft for user review)
const postVideoInitInbox = async (params: {
    accessToken: string;
    videoSize?: number;
    chunkSize?: number;
    totalChunkCount?: number;
}): Promise<{ publishId: string; uploadUrl: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: params.videoSize,
                chunk_size: params.chunkSize,
                total_chunk_count: params.totalChunkCount,
            },
        },
    });

    return {
        publishId: data.data?.publish_id || '',
        uploadUrl: data.data?.upload_url || ''
    };
};

// Post video to inbox using PULL_FROM_URL (user reviews and posts)
const postVideoInbox = async (params: {
    accessToken: string;
    videoUrl: string;
}): Promise<{ publishId: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: params.videoUrl,
            },
        },
    });

    return { publishId: data.data?.publish_id || '' };
};

// Initiate video upload using FILE_UPLOAD (direct post with metadata)
const postVideoInit = async (params: {
    accessToken: string;
    title?: string;
    privacyLevel: string;
    disableDuet?: boolean;
    disableStitch?: boolean;
    disableComment?: boolean;
    videoCoverTimestampMs?: number;
    videoSize?: number;
    chunkSize?: number;
    totalChunkCount?: number;
}): Promise<{ publishId: string; uploadUrl: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                privacy_level: params.privacyLevel,
                disable_duet: params.disableDuet ?? false,
                disable_stitch: params.disableStitch ?? false,
                disable_comment: params.disableComment ?? false,
                video_cover_timestamp_ms: params.videoCoverTimestampMs ?? 1000,
            },
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: params.videoSize,
                chunk_size: params.chunkSize,
                total_chunk_count: params.totalChunkCount,
            },
        },
    });

    return {
        publishId: data.data?.publish_id || '',
        uploadUrl: data.data?.upload_url || ''
    };
};

// Post photos using PULL_FROM_URL
const postPhotos = async (params: {
    accessToken: string;
    photoUrls: string[];
    title?: string;
    description?: string;
    privacyLevel: string;
    disableComment?: boolean;
    autoAddMusic?: boolean;
    photoCoverIndex?: number;
}): Promise<{ publishId: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/content/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                description: params.description || '',
                privacy_level: params.privacyLevel,
                disable_comment: params.disableComment ?? false,
                auto_add_music: params.autoAddMusic ?? true,
            },
            source_info: {
                source: 'PULL_FROM_URL',
                photo_cover_index: params.photoCoverIndex ?? 0,
                photo_images: params.photoUrls,
            },
            post_mode: 'DIRECT_POST',
            media_type: 'PHOTO',
        },
    });

    return { publishId: data.data?.publish_id || '' };
};

// Post photos to inbox using PULL_FROM_URL (user reviews and posts)
const postPhotosInbox = async (params: {
    accessToken: string;
    photoUrls: string[];
    title?: string;
    description?: string;
    photoCoverIndex?: number;
}): Promise<{ publishId: string }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/content/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                description: params.description || '',
            },
            source_info: {
                source: 'PULL_FROM_URL',
                photo_cover_index: params.photoCoverIndex ?? 0,
                photo_images: params.photoUrls,
            },
            post_mode: 'MEDIA_UPLOAD',  // Inbox mode - user reviews in TikTok app
            media_type: 'PHOTO',
        },
    });

    return { publishId: data.data?.publish_id || '' };
};

// Initiate photo upload using FILE_UPLOAD
const postPhotosInit = async (params: {
    accessToken: string;
    photoCount: number;
    title?: string;
    description?: string;
    privacyLevel: string;
    disableComment?: boolean;
    autoAddMusic?: boolean;
    photoCoverIndex?: number;
}): Promise<{ publishId: string; uploadUrls: string[] }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/content/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                description: params.description || '',
                privacy_level: params.privacyLevel,
                disable_comment: params.disableComment ?? false,
                auto_add_music: params.autoAddMusic ?? true,
            },
            source_info: {
                source: 'FILE_UPLOAD',
                photo_cover_index: params.photoCoverIndex ?? 0,
                photo_count: params.photoCount,
            },
            post_mode: 'DIRECT_POST',
            media_type: 'PHOTO',
        },
    });

    return {
        publishId: data.data?.publish_id || '',
        uploadUrls: data.data?.upload_urls || []
    };
};

// Initiate photo upload to inbox using FILE_UPLOAD (user reviews and posts)
const postPhotosInitInbox = async (params: {
    accessToken: string;
    photoCount: number;
    title?: string;
    description?: string;
    photoCoverIndex?: number;
}): Promise<{ publishId: string; uploadUrls: string[] }> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/content/init/', {
        method: 'POST',
        accessToken: params.accessToken,
        body: {
            post_info: {
                title: params.title || '',
                description: params.description || '',
            },
            source_info: {
                source: 'FILE_UPLOAD',
                photo_cover_index: params.photoCoverIndex ?? 0,
                photo_count: params.photoCount,
            },
            post_mode: 'MEDIA_UPLOAD',  // Inbox mode - user reviews in TikTok app
            media_type: 'PHOTO',
        },
    });

    return {
        publishId: data.data?.publish_id || '',
        uploadUrls: data.data?.upload_urls || []
    };
};

// Get post status
const getPostStatus = async (accessToken: string, publishId: string): Promise<{
    status: string;
    failReason?: string;
    publiclyAvailablePostId?: string[];
    uploadedBytes?: number;
    downloadedBytes?: number;
}> => {
    const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        method: 'POST',
        accessToken,
        body: { publish_id: publishId },
    });

    const d = data.data || {};
    return {
        status: d.status || 'UNKNOWN',
        failReason: d.fail_reason,
        publiclyAvailablePostId: d.publicaly_available_post_id,
        uploadedBytes: d.uploaded_bytes,
        downloadedBytes: d.downloaded_bytes,
    };
};

export default {
    async fetch(request: Request): Promise<Response> {
        const auth = await requireAuth(request);
        if (auth instanceof Response) return auth;

        const url = new URL(request.url);
        const op = (url.searchParams.get('op') || '').trim();
        if (!op) return errorJson('Missing op', 400);

        if (request.method !== 'POST') {
            return errorJson('Method not allowed', 405);
        }

        let body: any = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        try {
            // Generate OAuth URL
            if (op === 'tiktok-auth-url') {
                const state = String(body?.state || Math.random().toString(36).substring(2, 15));
                const authUrl = generateAuthUrl(state);
                return json({ authUrl, state });
            }

            // Exchange code for tokens
            if (op === 'tiktok-exchange') {
                const code = String(body?.code || '').trim();
                if (!code) return errorJson('Missing code', 400);
                const tokens = await exchangeCodeForToken(code);
                return json(tokens);
            }

            // Refresh access token
            if (op === 'tiktok-refresh') {
                const refreshToken = String(body?.refreshToken || '').trim();
                if (!refreshToken) return errorJson('Missing refreshToken', 400);
                const tokens = await refreshAccessToken(refreshToken);
                return json(tokens);
            }

            // Revoke access
            if (op === 'tiktok-revoke') {
                const accessToken = String(body?.accessToken || '').trim();
                if (!accessToken) return errorJson('Missing accessToken', 400);
                await revokeAccess(accessToken);
                return json({ success: true });
            }

            // Query creator info
            if (op === 'tiktok-creator-info') {
                const accessToken = String(body?.accessToken || '').trim();
                if (!accessToken) return errorJson('Missing accessToken', 400);
                const creatorInfo = await queryCreatorInfo(accessToken);
                return json(creatorInfo);
            }

            // Post video
            if (op === 'tiktok-post-video') {
                const accessToken = String(body?.accessToken || '').trim();
                const videoUrl = String(body?.videoUrl || '').trim();
                const title = body?.title;
                const privacyLevel = String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE');
                const disableDuet = body?.disableDuet;
                const disableStitch = body?.disableStitch;
                const disableComment = body?.disableComment;
                const videoCoverTimestampMs = body?.videoCoverTimestampMs;

                if (!accessToken) return errorJson('Missing accessToken', 400);
                if (!videoUrl) return errorJson('Missing videoUrl', 400);

                const result = await postVideo({
                    accessToken,
                    videoUrl,
                    title,
                    privacyLevel,
                    disableDuet,
                    disableStitch,
                    disableComment,
                    videoCoverTimestampMs,
                });
                return json(result);
            }

            // Post video init (for FILE_UPLOAD to inbox - user reviews)
            if (op === 'tiktok-post-video-init-inbox') {
                const accessToken = String(body?.accessToken || '').trim();
                const videoSize = body?.videoSize;
                const chunkSize = body?.chunkSize;
                const totalChunkCount = body?.totalChunkCount;

                if (!accessToken) return errorJson('Missing accessToken', 400);

                const result = await postVideoInitInbox({
                    accessToken,
                    videoSize,
                    chunkSize,
                    totalChunkCount,
                });
                return json(result);
            }

            // Post video to inbox (PULL_FROM_URL - user reviews)
            if (op === 'tiktok-post-video-inbox') {
                const accessToken = String(body?.accessToken || '').trim();
                const videoUrl = String(body?.videoUrl || '').trim();

                if (!accessToken) return errorJson('Missing accessToken', 400);
                if (!videoUrl) return errorJson('Missing videoUrl', 400);

                const result = await postVideoInbox({
                    accessToken,
                    videoUrl,
                });
                return json(result);
            }

            // Post video init (for FILE_UPLOAD direct post with metadata)
            if (op === 'tiktok-post-video-init') {
                let accessToken = String(body?.accessToken || '').trim();
                const title = body?.title;
                const privacyLevel = String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE');
                const disableDuet = body?.disableDuet;
                const disableStitch = body?.disableStitch;
                const disableComment = body?.disableComment;
                const videoCoverTimestampMs = body?.videoCoverTimestampMs;
                const videoSize = body?.videoSize;
                const chunkSize = body?.chunkSize;
                const totalChunkCount = body?.totalChunkCount;

                // If accessToken not provided, fetch from Firestore using authenticated user
                if (!accessToken) {
                    console.log('[TikTok API] accessToken not in body, fetching from Firestore for uid:', auth.uid);
                    const storedData = await getStoredTikTokData(auth.uid);
                    accessToken = storedData?.accessToken || '';
                    if (!accessToken) {
                        return errorJson('TikTok not connected for this user', 401);
                    }
                    console.log('[TikTok API] Got accessToken from Firestore');
                }

                const result = await postVideoInit({
                    accessToken,
                    title,
                    privacyLevel,
                    disableDuet,
                    disableStitch,
                    disableComment,
                    videoCoverTimestampMs,
                    videoSize,
                    chunkSize,
                    totalChunkCount,
                });
                return json(result);
            }

            // Post photos
            if (op === 'tiktok-post-photo') {
                let accessToken = String(body?.accessToken || '').trim();
                const photoUrls = Array.isArray(body?.photoUrls) ? body.photoUrls : [];
                const title = body?.title;
                const description = body?.description;
                const privacyLevel = String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE');
                const disableComment = body?.disableComment;
                const autoAddMusic = body?.autoAddMusic;
                const photoCoverIndex = body?.photoCoverIndex;

                // If accessToken not provided, fetch from Firestore using authenticated user
                if (!accessToken) {
                    console.log('[TikTok API] Photo: accessToken not in body, fetching from Firestore for uid:', auth.uid);
                    const storedData = await getStoredTikTokData(auth.uid);
                    accessToken = storedData?.accessToken || '';
                    if (!accessToken) {
                        return errorJson('TikTok not connected for this user', 401);
                    }
                    console.log('[TikTok API] Photo: Got accessToken from Firestore');
                }

                if (!photoUrls.length) return errorJson('Missing photoUrls', 400);

                const result = await postPhotos({
                    accessToken,
                    photoUrls,
                    title,
                    description,
                    privacyLevel,
                    disableComment,
                    autoAddMusic,
                    photoCoverIndex,
                });
                return json(result);
            }

            // Post photos to inbox (PULL_FROM_URL - user reviews)
            if (op === 'tiktok-post-photo-inbox') {
                const accessToken = String(body?.accessToken || '').trim();
                const photoUrls = Array.isArray(body?.photoUrls) ? body.photoUrls : [];
                const title = body?.title;
                const description = body?.description;
                const photoCoverIndex = body?.photoCoverIndex;

                if (!accessToken) return errorJson('Missing accessToken', 400);
                if (!photoUrls.length) return errorJson('Missing photoUrls', 400);

                const result = await postPhotosInbox({
                    accessToken,
                    photoUrls,
                    title,
                    description,
                    photoCoverIndex,
                });
                return json(result);
            }

            // Post photo init (for FILE_UPLOAD)
            if (op === 'tiktok-post-photo-init') {
                let accessToken = String(body?.accessToken || '').trim();
                const photoCount = body?.photoCount || 1;
                const title = body?.title;
                const description = body?.description;
                const privacyLevel = String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE');
                const disableComment = body?.disableComment;
                const autoAddMusic = body?.autoAddMusic;
                const photoCoverIndex = body?.photoCoverIndex;

                // If accessToken not provided, fetch from Firestore using authenticated user
                if (!accessToken) {
                    console.log('[TikTok API] Photo init: accessToken not in body, fetching from Firestore for uid:', auth.uid);
                    const storedData = await getStoredTikTokData(auth.uid);
                    accessToken = storedData?.accessToken || '';
                    if (!accessToken) {
                        return errorJson('TikTok not connected for this user', 401);
                    }
                    console.log('[TikTok API] Photo init: Got accessToken from Firestore');
                }

                const result = await postPhotosInit({
                    accessToken,
                    photoCount,
                    title,
                    description,
                    privacyLevel,
                    disableComment,
                    autoAddMusic,
                    photoCoverIndex,
                });
                return json(result);
            }

            // Post photo init to inbox (FILE_UPLOAD - user reviews)
            if (op === 'tiktok-post-photo-init-inbox') {
                const accessToken = String(body?.accessToken || '').trim();
                const photoCount = body?.photoCount;
                const title = body?.title;
                const description = body?.description;
                const photoCoverIndex = body?.photoCoverIndex;

                if (!accessToken) return errorJson('Missing accessToken', 400);
                if (!photoCount) return errorJson('Missing photoCount', 400);

                const result = await postPhotosInitInbox({
                    accessToken,
                    photoCount,
                    title,
                    description,
                    photoCoverIndex,
                });
                return json(result);
            }

            // Get post status
            if (op === 'tiktok-post-status') {
                const accessToken = String(body?.accessToken || '').trim();
                const publishId = String(body?.publishId || '').trim();

                if (!accessToken) return errorJson('Missing accessToken', 400);
                if (!publishId) return errorJson('Missing publishId', 400);

                const status = await getPostStatus(accessToken, publishId);
                return json(status);
            }

            return errorJson('Not found', 404);
        } catch (e: any) {
            console.error('TikTok API Error:', {
                message: e?.message,
                stack: e?.stack,
                error: e
            });
            return errorJson(e?.message || 'Internal error', 500);
        }
    },
};
