/**
 * Video Overview Generator API
 * Creates slideshow videos using Gemini for images + TTS audio, assembled via Creatomate
 * 
 * Uses QStash for background processing to avoid Vercel timeout limits.
 * 
 * Operations:
 * - POST ?op=start - Queue a video overview job, returns jobId immediately
 * - GET ?op=status&jobId=xxx - Poll job status
 * - POST ?op=process - QStash callback to do the actual work (internal use)
 */
import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { requireAuth } from './_auth.js';
import { Client as QStashClient } from '@upstash/qstash';

const CREATOMATE_BASE_URL = 'https://api.creatomate.com/v2';

const MODEL_PLAN = 'gemini-2.5-flash';
const MODEL_IMAGE_FAST = 'gemini-2.5-flash-image';
const MODEL_IMAGE_SMART = 'gemini-3-pro-image-preview';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TTS_FALLBACK = 'gemini-2.5-pro-preview-tts';

// Environment variables
// Environment variables
const qstashToken = process.env.QSTASH_TOKEN;
const vercelBypassToken = process.env.VERCEL_PROTECTION_BYPASS || '';
// Prioritize APP_URL for correct origin, custom callback URL support
const appUrl = process.env.APP_URL ? (process.env.APP_URL.startsWith('http') ? process.env.APP_URL : `https://${process.env.APP_URL}`) : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

// HeyGen API configuration
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || '';
const HEYGEN_DEFAULT_AVATAR_ID = process.env.HEYGEN_DEFAULT_AVATAR_ID || 'Santa_Claus_Front_public';
const HEYGEN_API_BASE = 'https://api.heygen.com';

// HeyGen avatar pools - randomly selected for each generation
const HEYGEN_FEMALE_AVATARS = [
    'Adriana_BizTalk_Front_public',
    'Georgia_expressive_2024112701',
    'Freja_public_1',
    'Emery_public_1',
    'Diora_public_5',
    'Abigail_expressive_2024112501',
];

const HEYGEN_MALE_AVATARS = [
    'Esmond_public_1',
    'Chad_in_Grey_Shirt_Front',
    'Darnell_Bordeaux_Polo_Front',
    'Colin_Suit_Front_public',
    'Iker_public_1',
    'Harrison_public_2_20240313',
];

// Gemini TTS voices matched to gender
// Gemini TTS voices matched to gender
// Female voices
const GEMINI_FEMALE_VOICES = [
    'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome',
    'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat',
    'Vindemiatrix', 'Zephyr'
];

// Male voices
const GEMINI_MALE_VOICES = [
    'Achird', 'Algenib', 'Alnilam', 'Charon', 'Enceladus', 'Fenrir',
    'Iapetus', 'Orus', 'Puck', 'Rasalgethi', 'Sadachbia', 'Sadaltager',
    'Schedar', 'Umbriel', 'Zubenelgenubi'
];

type AvatarSelection = {
    avatarId: string;
    gender: 'female' | 'male';
    voiceName: string;
};

/**
 * Select a random avatar and matching voice
 * Falls back to env default if available
 */
function selectRandomAvatar(): AvatarSelection {
    // Randomly choose gender
    const gender = Math.random() < 0.5 ? 'female' : 'male';

    // Select random avatar from the appropriate pool
    const avatarPool = gender === 'female' ? HEYGEN_FEMALE_AVATARS : HEYGEN_MALE_AVATARS;
    const avatarId = avatarPool[Math.floor(Math.random() * avatarPool.length)];

    // Select random matching voice
    const voicePool = gender === 'female' ? GEMINI_FEMALE_VOICES : GEMINI_MALE_VOICES;
    const voiceName = voicePool[Math.floor(Math.random() * voicePool.length)];

    return { avatarId, gender, voiceName };
}

// Build QStash callback URL with optional Vercel protection bypass
const buildQStashUrl = (action: string) => {
    // Use 'action' to correspond with the new server logic and avoid Vercel rewrite issues
    const baseUrl = `${appUrl}/api/video-overview?action=${action}`;
    const finalUrl = vercelBypassToken ? `${baseUrl}&x-vercel-protection-bypass=${vercelBypassToken}` : baseUrl;

    // Debug logging to verify bypass token configuration
    console.log('[video-overview] QStash URL config:', {
        appUrl,
        action,
        hasVercelBypassToken: !!vercelBypassToken,
        tokenLength: vercelBypassToken?.length || 0,
        finalUrl: finalUrl.replace(vercelBypassToken || '', vercelBypassToken ? '[REDACTED]' : ''),
    });

    return finalUrl;
};

// Initialize QStash client
const qstash = qstashToken ? new QStashClient({ token: qstashToken }) : null;

type OverviewRequest = {
    projectId?: string;
    prompt?: string;
    aspect?: string;
    contextDescription?: string;
    slideCount?: number;
    voiceName?: string;
};

type CreatomateRender = {
    id: string;
    status: string;
    url?: string;
    snapshot_url?: string;
    output_format?: string;
    width?: number;
    height?: number;
    duration?: number;
    file_size?: number;
    error_message?: string | null;
};

type SlidePlan = {
    title: string;
    bullets: string[];
    imagePrompt: string;
    voiceover: string;
    durationSeconds: number;
};

type OverviewPlan = {
    voiceoverText: string;
    slides: SlidePlan[];
    totalDurationSeconds: number;
};

// Job state stored in Firestore
type VideoOverviewJob = {
    id: string;
    projectId: string; // Top-level for easier querying
    status: 'queued' | 'processing' | 'generating_script' | 'generating_audio' | 'generating_images' | 'assembling' | 'generating_avatar' | 'completed' | 'failed';
    progress?: string;
    request: OverviewRequest;
    result?: {
        url: string;
        snapshotUrl?: string;
        durationSeconds?: number;
    };
    error?: string;
    createdAt: number;
    updatedAt: number;
    // Internal data for segmented processing
    internalData?: {
        plan?: OverviewPlan;
        audioUrl?: string;
        slideshowVideoUrl?: string; // Creatomate slideshow (without avatar)
        avatarVideoUrl?: string | null; // Final HeyGen video with avatar
        heygenVideoId?: string | null; // Pending HeyGen video ID for polling
        slideImageUrls?: string[];
        ownerUid?: string | null;
        width?: number;
        height?: number;
        aspectRatio?: string;
        // Random avatar/voice selection for this job
        selectedAvatarId?: string;
        selectedVoiceName?: string;
    };
};

// Payload for process callbacks (QStash)
type ProcessPayload = {
    jobId: string;
    step?: 'PLAN' | 'AUDIO' | 'IMAGE' | 'ASSEMBLY_SLIDES' | 'AVATAR_CREATE' | 'AVATAR_POLL';
    imageIndex?: number;
};

// Firestore persistence
let firestoreInitialized = false;
const ensureFirestore = async () => {
    if (firestoreInitialized) return;
    firestoreInitialized = true;

    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (getApps().length) return;

    const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT ||
        process.env.FIREBASE_ADMIN_CREDENTIALS || '{}'
    );
    if (serviceAccount.client_email && serviceAccount.private_key) {
        initializeApp({
            credential: cert({
                projectId: serviceAccount.project_id || 'ffresearchr',
                clientEmail: serviceAccount.client_email,
                privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
            }),
        });
    }
};

const getJob = async (jobId: string): Promise<VideoOverviewJob | null> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const doc = await db.collection('videoOverviewJobs').doc(jobId).get();
    if (!doc.exists) return null;
    return doc.data() as VideoOverviewJob;
};

const saveJob = async (job: VideoOverviewJob): Promise<void> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.collection('videoOverviewJobs').doc(job.id).set({
        ...job,
        updatedAt: Date.now(),
    });
};

const updateJobStatus = async (jobId: string, status: VideoOverviewJob['status'], progress?: string): Promise<void> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const update: any = { status, updatedAt: Date.now() };
    if (progress !== undefined) update.progress = progress;
    await db.collection('videoOverviewJobs').doc(jobId).update(update);
};

const listProjectJobs = async (projectId: string): Promise<VideoOverviewJob[]> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();

    const activeStatuses = ['queued', 'processing', 'generating_script', 'generating_audio', 'generating_images', 'assembling', 'generating_avatar'];

    try {
        console.log('[video-overview] listProjectJobs querying for projectId:', projectId);

        // Use simple query and filter in-memory to avoid Firebase index requirements
        // This is more flexible and works with both projectId and request.projectId
        const allJobs = await db.collection('videoOverviewJobs')
            .orderBy('createdAt', 'desc')
            .limit(100) // Increased limit to ensure we capture relevant jobs
            .get();

        const filtered = allJobs.docs
            .map(doc => doc.data() as VideoOverviewJob)
            .filter(job =>
                (job.projectId === projectId || job.request?.projectId === projectId) &&
                activeStatuses.includes(job.status)
            )
            .slice(0, 10); // Limit to 10 most recent after filtering

        console.log('[video-overview] listProjectJobs found', filtered.length, 'matching jobs');
        return filtered;
    } catch (e: any) {
        console.error('[video-overview] listProjectJobs query failed:', e?.message);
        return [];
    }
};


/**
 * Save an asset to the project's knowledgeBase in Firestore
 * This allows assets to appear in the appropriate tab (Blogs, Podcasts, Images, Videos)
 */
const saveAssetToProjectKnowledgeBase = async (
    projectId: string,
    ownerUid: string,
    asset: {
        name: string;
        type: string; // mime type like 'video/mp4', 'audio/wav', 'image/png', 'text/markdown'
        url: string;
        size?: number;
    }
): Promise<void> => {
    try {
        await ensureFirestore();
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        const db = getFirestore();

        const kbFile = {
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: asset.name,
            type: asset.type,
            size: asset.size || 0,
            url: asset.url,
            storagePath: '', // Blob URL already public
            uploadedAt: Date.now(),
        };

        // Update the project document in Firestore
        const projectRef = db.collection('users').doc(ownerUid).collection('researchProjects').doc(projectId);
        await projectRef.update({
            knowledgeBase: FieldValue.arrayUnion(kbFile),
            lastModified: Date.now(),
        });

        console.log(`[video-overview] Saved asset to project knowledgeBase: ${asset.name}`);
    } catch (e: any) {
        console.error(`[video-overview] Failed to save asset to knowledgeBase:`, e?.message);
        // Non-fatal error - don't throw, just log
    }
};

/**
 * Helper function to complete a job with the final video URL
 * Saves to assets and marks job completed
 */
const completeJobWithVideo = async (
    jobId: string,
    job: VideoOverviewJob,
    videoUrl: string
): Promise<void> => {
    const { internalData, request } = job;
    const projectId = (request.projectId || '').trim();
    const prompt = (request.prompt || '').trim();
    const ownerUid = internalData?.ownerUid;

    // Save final video to project assets
    if (ownerUid) {
        await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
            name: `Video Overview - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.mp4`,
            type: 'video/mp4',
            url: videoUrl,
        });
    }

    // Mark job completed
    const updatedJob: VideoOverviewJob = {
        ...job,
        status: 'completed',
        result: {
            url: videoUrl,
            snapshotUrl: null,
            durationSeconds: internalData?.plan?.totalDurationSeconds || 0,
        },
        updatedAt: Date.now(),
    };
    await saveJob(updatedJob);
    console.log(`[video-overview] Job ${jobId} completed with video:`, videoUrl);
};

/**
 * Get the owner UID for a project from Firestore
 */
const getProjectOwnerUid = async (projectId: string): Promise<string | null> => {
    try {
        await ensureFirestore();
        const { getFirestore } = await import('firebase-admin/firestore');
        const db = getFirestore();

        // Search for the project across all users
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const projectDoc = await db.collection('users').doc(userDoc.id).collection('researchProjects').doc(projectId).get();
            if (projectDoc.exists) {
                return userDoc.id;
            }
        }
        return null;
    } catch (e) {
        console.error('[video-overview] Failed to get project owner:', e);
        return null;
    }
};

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorResponse = (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const generateJobId = () =>
    `vo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

const getCreatomateApiKey = (): string => {
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) throw new Error('Missing CREATOMATE_API_KEY environment variable');
    return key;
};

const getGeminiKey = (): string => {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!key) throw new Error('Missing GEMINI_API_KEY environment variable');
    return key;
};

const getBlobToken = (): string | undefined =>
    process.env.researcher_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || undefined;

const parseAspect = (aspect?: string): { width: number; height: number; aspectRatio: '16:9' | '9:16' } => {
    const fallback = { width: 1280, height: 720, aspectRatio: '16:9' as const };
    if (!aspect) return fallback;
    const m = aspect.match(/^(\d+)x(\d+)$/);
    if (!m) return fallback;
    const width = parseInt(m[1], 10);
    const height = parseInt(m[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    const aspectRatio: '16:9' | '9:16' = width >= height ? '16:9' : '9:16';
    return { width, height, aspectRatio };
};

const toDataUrl = (base64: string, mimeType = 'image/png') => `data:${mimeType};base64,${base64}`;

const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } => {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { mimeType: match[1] || 'application/octet-stream', base64: match[2] || '' };
};

async function postRender(script: any): Promise<CreatomateRender> {
    const apiKey = getCreatomateApiKey();
    const res = await fetch(`${CREATOMATE_BASE_URL}/renders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(script),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate render create failed: ${res.status} ${text}`);
    }

    return (await res.json()) as CreatomateRender;
}

async function getRender(id: string): Promise<CreatomateRender> {
    const apiKey = getCreatomateApiKey();
    const res = await fetch(`${CREATOMATE_BASE_URL}/renders/${id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate get render failed: ${res.status} ${text}`);
    }

    return (await res.json()) as CreatomateRender;
}

async function pollCreatomateRenderUntilComplete(
    id: string,
    { pollMs = 5000, timeoutMs = 420000 }: { pollMs?: number; timeoutMs?: number } = {},
): Promise<CreatomateRender> {
    const start = Date.now();
    let last: CreatomateRender | null = null;

    while (true) {
        last = await getRender(id);
        if (last.status === 'succeeded' || last.status === 'failed') return last;
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Creatomate render timeout after ${timeoutMs}ms (last status: ${last.status})`);
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

// ---------------------------------------------------------
// HeyGen API Helpers
// ---------------------------------------------------------

// Note: uploadAudioToHeyGen removed - using audio_url directly in V2 API instead

/**
 * Create an avatar video with HeyGen using V2 API with video background
 * Uses the Creatomate slideshow as background and overlays the avatar
 */
async function createHeyGenAvatarVideo(
    audioUrl: string,
    videoBackgroundUrl: string,
    avatarId: string = HEYGEN_DEFAULT_AVATAR_ID,
    width: number = 1280,
    height: number = 720
): Promise<string> {
    if (!HEYGEN_API_KEY) {
        throw new Error('HEYGEN_API_KEY is not configured');
    }

    // Use V2 API with video background - avatar overlaid on slideshow
    const payload = {
        video_inputs: [{
            character: {
                type: 'avatar',
                avatar_id: avatarId,
                avatar_style: 'normal',
            },
            voice: {
                type: 'audio',
                audio_url: audioUrl,
            },
            background: {
                type: 'video',
                url: videoBackgroundUrl,
                play_style: 'fit_to_scene', // Match duration to voice
            },
        }],
        dimension: {
            width,
            height,
        },
    };

    console.log('[video-overview] [HEYGEN] Creating avatar video with video background, payload:', JSON.stringify(payload));

    const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
        method: 'POST',
        headers: {
            'X-Api-Key': HEYGEN_API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[video-overview] [HEYGEN] V2 API error response:', text);
        throw new Error(`HeyGen V2 video create failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    console.log('[video-overview] [HEYGEN] V2 API response:', JSON.stringify(data));

    if (!data.data?.video_id) {
        throw new Error('HeyGen V2 video create did not return video_id');
    }

    console.log('[video-overview] [HEYGEN] Created video, video_id:', data.data.video_id);
    return data.data.video_id;
}

/**
 * Poll HeyGen video status until complete
 */
async function pollHeyGenVideoUntilComplete(
    videoId: string,
    { pollMs = 5000, timeoutMs = 300000 }: { pollMs?: number; timeoutMs?: number } = {},
): Promise<string> {
    if (!HEYGEN_API_KEY) {
        throw new Error('HEYGEN_API_KEY is not configured');
    }

    const start = Date.now();

    while (true) {
        const res = await fetch(`${HEYGEN_API_BASE}/v1/video_status.get?video_id=${videoId}`, {
            method: 'GET',
            headers: {
                'X-Api-Key': HEYGEN_API_KEY,
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HeyGen video status failed: ${res.status} ${text}`);
        }

        const data = await res.json();
        const status = data.data?.status;

        console.log(`[video-overview] [HEYGEN] Video ${videoId} status: ${status}`);

        if (status === 'completed') {
            const videoUrl = data.data?.video_url;
            if (!videoUrl) {
                throw new Error('HeyGen video completed but no video_url returned');
            }
            return videoUrl;
        }

        if (status === 'failed') {
            throw new Error(`HeyGen video generation failed: ${data.data?.error || 'Unknown error'}`);
        }

        if (Date.now() - start > timeoutMs) {
            throw new Error(`HeyGen video timeout after ${timeoutMs}ms (last status: ${status})`);
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }
}

/**
 * Generate the video overview script plan using Gemini
 */
async function generateOverviewPlan(context: string, slideCount: number): Promise<OverviewPlan> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const targetSecondsPerSlide = 8; // Reduced from 10 to keep under 2 min
    const totalTargetSeconds = Math.min(slideCount * targetSecondsPerSlide, 100); // Cap at 100s
    const hardMaxSeconds = 120; // Absolute maximum (HeyGen limit is 180s, using 120s for safety)

    const prompt = `You are generating a VIDEO OVERVIEW script that will be turned into a narrated slideshow video.

CRITICAL DURATION CONSTRAINT:
- The TOTAL narration MUST NOT EXCEED ${hardMaxSeconds} seconds when spoken.
- Target: ~${totalTargetSeconds} seconds total
- This is a HARD LIMIT. The video will fail if longer than ${hardMaxSeconds}s.

Requirements:
- Output JSON only.
- Create EXACTLY ${slideCount} slides.
- Each slide should be ~${targetSecondsPerSlide} seconds of narration (brief and concise).
- Each slide must have:
  - title (short, 3-6 words)
  - bullets (2-3 SHORT bullet points, max 8 words each)
  - voiceover (BRIEF narration, 1-2 sentences max, ~${targetSecondsPerSlide}s when spoken at normal pace)
  - durationSeconds (estimated speaking duration, typically ${targetSecondsPerSlide}-${targetSecondsPerSlide + 2})
  - imagePrompt (detailed visual prompt for generating a 16:9 slide background image. REQUIREMENTS:
    * CRITICAL: Keep the CENTER of the image CLEAR/EMPTY - an avatar will be placed there. Place all text, graphics, and key visual elements on the LEFT and RIGHT SIDES only.
    * The slide title/headline MUST be incorporated NATURALLY and CREATIVELY into the scene on the LEFT or RIGHT side - for example as signage, a billboard, projected text, neon lights, carved in stone, written on a whiteboard, displayed on a screen, etc.
    * The visual scene MUST directly represent the key topic/point of that slide in a relevant and creative way.
    * Use a MIX of visual styles throughout the slides - alternate between: photorealistic real-world scenes, professional infographics with icons and data, business diagrams and flowcharts, charts/graphs with data visualizations, modern presentation slide aesthetics.
    * Make the title text large, high-contrast, and clearly legible within the scene.
    * The overall aesthetic should be modern, professional, and visually striking.)
- Also generate a single voiceoverText that is the FULL concatenation of all slide voiceovers.
- Keep the tone clear, professional, and executive-summary-like.
- BE CONCISE: Prioritize key insights over comprehensive coverage.
- Prefer concrete claims and numbers when present in the context.
- Keep bullets short enough to fit on-screen.

Context:
"""
${(context || '').trim().slice(0, 12000)}
"""

Return ONLY valid JSON:
{
  "voiceoverText": "...",
  "totalDurationSeconds": ${totalTargetSeconds},
  "slides": [
    { "title": "...", "bullets": ["...", "..."], "voiceover": "...", "durationSeconds": ${targetSecondsPerSlide}, "imagePrompt": "..." }
  ]
}`;

    const response = await client.models.generateContent({
        model: MODEL_PLAN,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.7, maxOutputTokens: 8000 },
    });

    const text = (response.text || '').trim();
    let cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanJson.indexOf('{');
    const end = cleanJson.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleanJson = cleanJson.substring(start, end + 1);

    const parsed = JSON.parse(cleanJson) as OverviewPlan;
    if (!parsed?.voiceoverText || !Array.isArray(parsed.slides)) {
        throw new Error('Invalid overview plan returned from Gemini');
    }

    for (const slide of parsed.slides) {
        if (!slide?.title || !Array.isArray(slide?.bullets) || !slide?.imagePrompt || !slide?.voiceover) {
            throw new Error('Invalid slide structure returned from Gemini');
        }
    }

    return parsed;
}

/**
 * Generate image using Gemini (with fallback)
 */
async function generateGeminiImageDataUrl(prompt: string, aspectRatio: '16:9' | '9:16'): Promise<string> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const attemptModel = async (model: string) => {
        const response = await client.models.generateContent({
            model,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    aspectRatio,
                    ...(model === MODEL_IMAGE_SMART ? { imageSize: '1K' } : {}),
                },
            },
        });

        const candidateParts = (response as any)?.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
            if (part?.inlineData?.data) {
                return toDataUrl(part.inlineData.data, part.inlineData.mimeType || 'image/png');
            }
        }
        throw new Error('No inline image returned from Gemini');
    };

    try {
        return await attemptModel(MODEL_IMAGE_SMART);
    } catch (e) {
        console.warn('[video-overview] Gemini 3 Pro image failed, falling back to Flash image', e);
        return attemptModel(MODEL_IMAGE_FAST);
    }
}

/**
 * Generate voiceover audio using Gemini TTS
 */
async function generateGeminiTTSAudio(
    text: string,
    voiceName: string = 'Kore'
): Promise<{ audioData: string; mimeType: string }> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const styledPrompt = `Read this narration in a clear, professional, and engaging tone suitable for a video overview:

${text}`;

    const tryModels = [MODEL_TTS, MODEL_TTS_FALLBACK];
    let response: any;
    let pcmData: string | null = null;

    for (const model of tryModels) {
        try {
            response = await client.models.generateContent({
                model,
                contents: [{ parts: [{ text: styledPrompt }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName }
                        }
                    }
                } as any
            });

            const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part?.inlineData?.data) {
                    pcmData = part.inlineData.data;
                    break;
                }
            }
            if (pcmData) break;
        } catch (e) {
            console.warn(`[video-overview] TTS model ${model} failed, trying next...`, e);
        }
    }

    if (!pcmData) {
        throw new Error('No audio data received from Gemini TTS');
    }

    // Convert PCM to WAV
    const pcmBytes = Uint8Array.from(atob(pcmData), c => c.charCodeAt(0));
    const wavBytes = pcmToWav(pcmBytes, 24000, 1, 16);

    // Convert to base64 in chunks
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < wavBytes.length; i += chunkSize) {
        const chunk = wavBytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    const wavBase64 = btoa(binary);

    return { audioData: wavBase64, mimeType: 'audio/wav' };
}

/**
 * Convert PCM to WAV format
 */
function pcmToWav(pcmData: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataLength = pcmData.length;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // PCM data
    const output = new Uint8Array(buffer);
    output.set(pcmData, headerLength);

    return output;
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Upload data URL to Vercel Blob
 */
async function uploadDataUrlToBlob(projectId: string, filename: string, dataUrl: string): Promise<string> {
    const { mimeType, base64 } = parseDataUrl(dataUrl);
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    const pathname = `projects/${projectId}/${filename}`;
    const stored = await put(pathname, blob, {
        access: 'public',
        addRandomSuffix: true,
        token: getBlobToken(),
    });
    return stored.url;
}

/**
 * Upload raw base64 audio to Vercel Blob
 */
async function uploadAudioToBlob(projectId: string, filename: string, base64Audio: string, mimeType: string): Promise<string> {
    const buffer = Buffer.from(base64Audio, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    const pathname = `projects/${projectId}/${filename}`;
    const stored = await put(pathname, blob, {
        access: 'public',
        addRandomSuffix: true,
        token: getBlobToken(),
    });
    return stored.url;
}

/**
 * Build Creatomate RenderScript for video overview
 */
function buildOverviewRenderScript(params: {
    width: number;
    height: number;
    audioUrl: string;
    avatarVideoUrl?: string | null;
    slides: { imageUrl: string; title: string; bullets: string[]; durationSeconds: number }[];
}): any {
    const { width, height, audioUrl, avatarVideoUrl, slides } = params;

    console.log('[buildOverviewRenderScript] Called with avatarVideoUrl:', avatarVideoUrl || 'null/undefined');

    let currentTime = 0;
    const timedSlides = slides.map((slide, idx) => {
        const startTime = currentTime;
        currentTime += slide.durationSeconds;
        return { ...slide, startTime, idx };
    });

    const totalDuration = currentTime;

    const script: any = {
        output_format: 'mp4',
        width,
        height,
        duration: totalDuration,
        elements: [] as any[],
    };

    // Add audio track (muted - HeyGen avatar will provide audio with lip-sync)
    script.elements.push({
        type: 'audio',
        track: 1,
        time: 0,
        source: audioUrl,
        duration: totalDuration,
        volume: '0%', // Muted to avoid double audio with HeyGen avatar
        audio_fade_out: 1.5,
    });

    // Add image slides on track 2
    timedSlides.forEach((slide, idx) => {
        const sceneElements: any[] = [];

        // Background image with zoom effect
        sceneElements.push({
            type: 'image',
            source: slide.imageUrl,
            fit: 'cover',
            clip: true,
            animations: [
                {
                    easing: 'linear',
                    type: 'scale',
                    scope: 'element',
                    start_scale: '112%',
                    end_scale: '100%',
                    fade: false,
                },
            ],
        });

        // Dark overlay
        sceneElements.push({
            type: 'shape',
            x: '50%',
            y: '50%',
            width: '100%',
            height: '100%',
            fill_color: 'rgba(0,0,0,0.22)',
        });


        const scene: any = {
            type: 'composition',
            name: `Scene-${idx + 1}`,
            track: 2,
            time: slide.startTime,
            duration: slide.durationSeconds,
            elements: sceneElements,
        };

        // Add fade transition for slides after the first
        if (idx > 0) {
            scene.animations = [
                {
                    time: 0,
                    duration: 0.6,
                    easing: 'cubic-in-out',
                    transition: true,
                    type: 'fade',
                    enable: 'second-only',
                },
            ];
        }

        script.elements.push(scene);
    });

    // Avatar is no longer overlaid here - it's handled by HeyGen as a video background
    // in the final step where the slideshow becomes the background for the avatar

    return script;
}

/**
 * Process the video overview job - Routes to appropriate step handler
 */
async function processVideoOverviewJob(payload: ProcessPayload): Promise<void> {
    const { jobId, step = 'PLAN', imageIndex = 0 } = payload;
    console.log(`[video-overview] Processing step ${step} for job ${jobId}`);

    switch (step) {
        case 'PLAN':
            await processStepPlan(jobId);
            break;
        case 'AUDIO':
            await processStepAudio(jobId);
            break;
        case 'IMAGE':
            await processStepImage(jobId, imageIndex);
            break;
        case 'ASSEMBLY_SLIDES':
            await processStepAssemblySlides(jobId);
            break;
        case 'AVATAR_CREATE':
            await processStepAvatarCreate(jobId);
            break;
        case 'AVATAR_POLL':
            await processStepAvatarPoll(jobId);
            break;
        default:
            console.error(`[video-overview] Unknown step: ${step}`);
    }
}

/**
 * Step PLAN: Generate script plan, save to job, trigger AUDIO
 */
async function processStepPlan(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    try {
        const { request } = job;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();

        const slideCount = typeof request.slideCount === 'number' && request.slideCount > 0 && request.slideCount <= 20
            ? Math.floor(request.slideCount)
            : 12;

        // Enforce 720p resolution to avoid HeyGen plan limits
        // const { width, height, aspectRatio } = parseAspect(request.aspect);
        const aspectRatio = request.aspect === '9:16' ? '9:16' : '16:9';
        const width = aspectRatio === '9:16' ? 720 : 1280;
        const height = aspectRatio === '9:16' ? 1280 : 720;
        const ownerUid = await getProjectOwnerUid(projectId);

        // Generate script
        await updateJobStatus(jobId, 'generating_script', 'Generating script plan...');
        console.log('[video-overview] [PLAN] Generating script plan...');
        const plan = await generateOverviewPlan(request.contextDescription || '', slideCount);

        // Save script to Blogs
        if (ownerUid) {
            const scriptContent = `# Video Overview Script\n\n**Prompt:** ${prompt}\n\n## Full Narration\n\n${plan.voiceoverText}\n\n## Slides\n\n${plan.slides.map((s, i) => `### Slide ${i + 1}: ${s.title}\n\n${s.bullets.map(b => `- ${b}`).join('\n')}\n\n*Voiceover:* ${s.voiceover}\n`).join('\n')}`;
            const scriptBuffer = Buffer.from(scriptContent, 'utf-8');
            const stored = await put(`projects/${projectId}/overview-script-${Date.now()}.md`, scriptBuffer, {
                access: 'public',
                addRandomSuffix: true,
                token: getBlobToken(),
            });
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Overview Script - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.md`,
                type: 'text/markdown',
                url: stored.url,
                size: scriptContent.length,
            });
        }

        // Select random avatar and matching voice for this job
        const avatarSelection = selectRandomAvatar();
        console.log(`[video-overview] [PLAN] Selected avatar: ${avatarSelection.avatarId} (${avatarSelection.gender}), voice: ${avatarSelection.voiceName}`);

        // Save plan to job and trigger AUDIO step
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_audio',
            progress: 'Plan complete, generating audio...',
            internalData: {
                plan,
                slideImageUrls: [],
                ownerUid: ownerUid || null,
                width,
                height,
                aspectRatio,
                selectedAvatarId: avatarSelection.avatarId,
                selectedVoiceName: avatarSelection.voiceName,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [PLAN] Triggering AUDIO step');
        await triggerNextStep(jobId, 'AUDIO');

    } catch (error: any) {
        console.error(`[video-overview] [PLAN] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Unknown error in PLAN');
    }
}

/**
 * Step AUDIO: Generate TTS audio, save to job, trigger first IMAGE
 */
async function processStepAudio(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan) {
        await markJobFailed(jobId, 'Missing plan data in AUDIO step');
        return;
    }

    try {
        const { plan, ownerUid, width, height, aspectRatio, selectedVoiceName } = internalData;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();
        // Use selected voice from avatar selection, fallback to request or default
        const voiceName = selectedVoiceName || request.voiceName || 'Kore';
        console.log(`[video-overview] [AUDIO] Using TTS voice: ${voiceName}`);

        // Generate TTS audio
        await updateJobStatus(jobId, 'generating_audio', 'Generating voiceover audio...');
        console.log('[video-overview] [AUDIO] Generating TTS audio...');
        const { audioData, mimeType } = await generateGeminiTTSAudio(plan.voiceoverText, voiceName);
        const audioUrl = await uploadAudioToBlob(projectId, `overview-audio-${Date.now()}.wav`, audioData, mimeType);

        // Save audio to Podcasts
        if (ownerUid) {
            const audioBuffer = Buffer.from(audioData, 'base64');
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Overview Voiceover - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.wav`,
                type: 'audio/wav',
                url: audioUrl,
                size: audioBuffer.length,
            });
        }

        // Save audio URL to job and trigger IMAGE step
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_images',
            progress: 'Generating slide 1...',
            internalData: {
                ...internalData,
                audioUrl,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [AUDIO] Triggering IMAGE step');
        await triggerNextStep(jobId, 'IMAGE', 0);

    } catch (error: any) {
        console.error(`[video-overview] [AUDIO] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Unknown error in AUDIO');
    }
}

/**
 * Step AVATAR_CREATE: Submit HeyGen video generation request
 * Saves video_id for polling in next step
 */
async function processStepAvatarCreate(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.audioUrl || !internalData?.slideshowVideoUrl) {
        await markJobFailed(jobId, 'Missing audioUrl or slideshowVideoUrl in AVATAR_CREATE step');
        return;
    }

    // Check if HeyGen is configured - if not, use slideshowVideoUrl as final
    if (!HEYGEN_API_KEY) {
        console.log('[video-overview] [AVATAR_CREATE] HeyGen not configured, using slideshow as final video');
        await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
        return;
    }

    try {
        // Use selected avatar or fallback to env default
        const avatarId = internalData.selectedAvatarId || HEYGEN_DEFAULT_AVATAR_ID;

        await updateJobStatus(jobId, 'processing', 'Creating avatar video...');
        console.log('[video-overview] [AVATAR_CREATE] Starting HeyGen avatar generation');
        console.log('[video-overview] [AVATAR_CREATE] Using avatar:', avatarId);
        console.log('[video-overview] [AVATAR_CREATE] Using audio URL:', internalData.audioUrl);
        console.log('[video-overview] [AVATAR_CREATE] Using video background:', internalData.slideshowVideoUrl);

        // Create avatar video with slideshow as background
        const videoId = await createHeyGenAvatarVideo(
            internalData.audioUrl,
            internalData.slideshowVideoUrl,
            avatarId,
            internalData.width,
            internalData.height
        );
        console.log('[video-overview] [AVATAR_CREATE] HeyGen video submitted, video_id:', videoId);

        // Save video_id to job for polling
        const updatedJob: VideoOverviewJob = {
            ...job,
            progress: 'Avatar video queued...',
            internalData: {
                ...internalData,
                heygenVideoId: videoId,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        // Trigger poll step with 10 second delay
        console.log('[video-overview] [AVATAR_CREATE] Triggering AVATAR_POLL with 10s delay');
        await triggerNextStepWithDelay(jobId, 'AVATAR_POLL', 10);

    } catch (error: any) {
        console.error(`[video-overview] [AVATAR_CREATE] Job ${jobId} failed:`, error);
        console.log('[video-overview] [AVATAR_CREATE] Falling back to slideshow without avatar...');

        // Use slideshow as final video (fallback without avatar)
        await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
    }
}

/**
 * Step AVATAR_POLL: Poll HeyGen for video completion
 * Re-queues itself until complete or timeout
 */
async function processStepAvatarPoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData } = job;
    const videoId = internalData?.heygenVideoId;

    if (!videoId) {
        console.log('[video-overview] [AVATAR_POLL] No heygenVideoId, falling back to slideshow');
        if (internalData?.slideshowVideoUrl) {
            await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
        } else {
            await markJobFailed(jobId, 'No video available in AVATAR_POLL');
        }
        return;
    }

    try {
        // Check HeyGen video status
        const res = await fetch(`${HEYGEN_API_BASE}/v1/video_status.get?video_id=${videoId}`, {
            method: 'GET',
            headers: { 'X-Api-Key': HEYGEN_API_KEY },
        });

        if (!res.ok) {
            throw new Error(`HeyGen status check failed: ${res.status}`);
        }

        const data = await res.json();
        const status = data.data?.status;
        console.log(`[video-overview] [AVATAR_POLL] Video ${videoId} status: ${status}`);

        if (status === 'completed') {
            const avatarVideoUrl = data.data?.video_url;
            console.log('[video-overview] [AVATAR_POLL] Avatar video ready:', avatarVideoUrl);

            // Complete job with the final HeyGen video
            await completeJobWithVideo(jobId, job, avatarVideoUrl);

        } else if (status === 'failed') {
            console.error('[video-overview] [AVATAR_POLL] HeyGen video failed');
            // Fallback to slideshow without avatar
            if (internalData?.slideshowVideoUrl) {
                console.log('[video-overview] [AVATAR_POLL] Falling back to slideshow');
                await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
            } else {
                await markJobFailed(jobId, 'HeyGen failed and no slideshow available');
            }

        } else if (status === 'pending' || status === 'processing' || status === 'waiting') {
            // Still in progress - re-queue with delay
            console.log(`[video-overview] [AVATAR_POLL] Status: ${status}, re-queuing with 10s delay`);
            await updateJobStatus(jobId, 'processing', `Avatar video: ${status}...`);
            await triggerNextStepWithDelay(jobId, 'AVATAR_POLL', 10);
        } else {
            // Unknown status - fallback to slideshow
            console.warn(`[video-overview] [AVATAR_POLL] Unknown status: ${status}, falling back to slideshow`);
            if (internalData?.slideshowVideoUrl) {
                await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
            } else {
                await markJobFailed(jobId, 'Unknown HeyGen status and no slideshow available');
            }
        }

    } catch (error: any) {
        console.error(`[video-overview] [AVATAR_POLL] Error:`, error);
        // Fallback to slideshow on error
        if (internalData?.slideshowVideoUrl) {
            console.log('[video-overview] [AVATAR_POLL] Error occurred, falling back to slideshow');
            await completeJobWithVideo(jobId, job, internalData.slideshowVideoUrl);
        } else {
            await markJobFailed(jobId, error?.message || 'AVATAR_POLL error');
        }
    }
}

/**
 * Step IMAGE: Generate one image, save, trigger next image or assembly
 */
async function processStepImage(jobId: string, imageIndex: number): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan) {
        await markJobFailed(jobId, 'Missing plan data in IMAGE step');
        return;
    }

    try {
        const { plan, slideImageUrls = [], ownerUid, aspectRatio } = internalData;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();

        const slide = plan.slides[imageIndex];
        if (!slide) {
            console.log(`[video-overview] [IMAGE] No slide at index ${imageIndex}, moving to ASSEMBLY_SLIDES`);
            await triggerNextStep(jobId, 'ASSEMBLY_SLIDES');
            return;
        }

        await updateJobStatus(jobId, 'generating_images', `Generating slide ${imageIndex + 1} of ${plan.slides.length}...`);
        console.log(`[video-overview] [IMAGE] Generating slide ${imageIndex + 1}/${plan.slides.length}...`);

        const imagePrompt = (slide.imagePrompt || '').trim() || `${slide.title || 'Slide'} - ${prompt}`;
        const img = await generateGeminiImageDataUrl(imagePrompt, (aspectRatio || '16:9') as '16:9' | '9:16');
        const url = await uploadDataUrlToBlob(projectId, `overview-slide-${imageIndex + 1}-${Date.now()}.png`, img);

        // Add to slideImageUrls
        const newSlideImageUrls = [...slideImageUrls];
        newSlideImageUrls[imageIndex] = url;

        // Save image to project
        if (ownerUid) {
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Slide ${imageIndex + 1} - ${slide.title || prompt.slice(0, 30)}.png`,
                type: 'image/png',
                url: url,
            });
        }

        // Update job with new image URL
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: {
                ...internalData,
                slideImageUrls: newSlideImageUrls,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        // Trigger next
        const nextIndex = imageIndex + 1;
        if (nextIndex < plan.slides.length) {
            console.log(`[video-overview] [IMAGE] Triggering IMAGE step ${nextIndex}`);
            await triggerNextStep(jobId, 'IMAGE', nextIndex);
        } else {
            console.log('[video-overview] [IMAGE] All images done, triggering ASSEMBLY_SLIDES');
            await triggerNextStep(jobId, 'ASSEMBLY_SLIDES');
        }

    } catch (error: any) {
        console.error(`[video-overview] [IMAGE] Job ${jobId} failed at index ${imageIndex}:`, error);
        await markJobFailed(jobId, error?.message || `Image generation failed at slide ${imageIndex + 1}`);
    }
}

/**
 * Step ASSEMBLY_SLIDES: Build and render the slideshow with Creatomate (no avatar)
 */
async function processStepAssemblySlides(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan || !internalData?.audioUrl || !internalData?.slideImageUrls) {
        await markJobFailed(jobId, 'Missing data in ASSEMBLY_SLIDES step');
        return;
    }

    try {
        const { plan, audioUrl, slideImageUrls, ownerUid, width = 1280, height = 720 } = internalData;
        const projectId = (request.projectId || '').trim();

        await updateJobStatus(jobId, 'assembling', 'Assembling slideshow...');
        console.log('[video-overview] [ASSEMBLY_SLIDES] Building Creatomate script (no avatar)...');

        const slides = plan.slides.map((s, idx) => ({
            imageUrl: slideImageUrls[idx] || '',
            title: String(s.title || '').trim(),
            bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b ?? '').trim()).filter(Boolean) : [],
            durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : 10,
        }));

        // Build script WITHOUT avatar (avatarVideoUrl = undefined)
        const script = buildOverviewRenderScript({ width, height, audioUrl, avatarVideoUrl: undefined, slides });

        console.log('[video-overview] [ASSEMBLY_SLIDES] Submitting to Creatomate...');
        const created = await postRender(script);
        const final = await pollCreatomateRenderUntilComplete(created.id);

        if (final.status !== 'succeeded' || !final.url) {
            throw new Error(final.error_message || `Creatomate render failed with status ${final.status}`);
        }

        console.log('[video-overview] [ASSEMBLY_SLIDES] Slideshow ready:', final.url);

        // Save slideshow URL and trigger AVATAR_CREATE
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_avatar',
            progress: 'Creating avatar video...',
            internalData: {
                ...internalData,
                slideshowVideoUrl: final.url,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [ASSEMBLY_SLIDES] Triggering AVATAR_CREATE step');
        await triggerNextStep(jobId, 'AVATAR_CREATE');

    } catch (error: any) {
        console.error(`[video-overview] [ASSEMBLY_SLIDES] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Assembly failed');
    }
}

/**
 * Helper to trigger the next step via QStash
 */
async function triggerNextStep(jobId: string, step: 'PLAN' | 'AUDIO' | 'IMAGE' | 'ASSEMBLY_SLIDES' | 'AVATAR_CREATE' | 'AVATAR_POLL', imageIndex?: number): Promise<void> {
    if (!qstash) {
        console.error('[video-overview] QStash not configured, cannot trigger next step');
        await markJobFailed(jobId, 'QStash not configured');
        return;
    }

    const qstashUrl = buildQStashUrl('process');
    const payload: ProcessPayload = { jobId, step, imageIndex };

    console.log(`[video-overview] Triggering next step: ${step} via QStash at ${qstashUrl}`);

    // Build headers with bypass token if available
    const headers: Record<string, string> = {};
    if (vercelBypassToken) {
        headers['x-vercel-protection-bypass'] = vercelBypassToken;
        console.log('[video-overview] Added x-vercel-protection-bypass header to QStash request');
    }

    await qstash.publishJSON({
        url: qstashUrl,
        body: payload,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        retries: 2,
    });
}

/**
 * Helper to trigger the next step via QStash with a delay
 */
async function triggerNextStepWithDelay(jobId: string, step: 'PLAN' | 'AUDIO' | 'IMAGE' | 'ASSEMBLY_SLIDES' | 'AVATAR_CREATE' | 'AVATAR_POLL', delaySeconds: number): Promise<void> {
    if (!qstash) {
        console.error('[video-overview] QStash not configured, cannot trigger next step');
        await markJobFailed(jobId, 'QStash not configured');
        return;
    }

    const qstashUrl = buildQStashUrl('process');
    const payload: ProcessPayload = { jobId, step };

    console.log(`[video-overview] Triggering ${step} with ${delaySeconds}s delay via QStash`);

    // Build headers with bypass token if available
    const headers: Record<string, string> = {};
    if (vercelBypassToken) {
        headers['x-vercel-protection-bypass'] = vercelBypassToken;
    }

    await qstash.publishJSON({
        url: qstashUrl,
        body: payload,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        retries: 2,
        delay: delaySeconds,
    });
}

/**
 * Helper to mark job as failed
 */
async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    const job = await getJob(jobId);
    if (job) {
        const failedJob: VideoOverviewJob = {
            ...job,
            status: 'failed',
            error: errorMessage,
            updatedAt: Date.now(),
        };
        await saveJob(failedJob);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        // Handle Vercel rewrites where op might be 'video-overview' first
        // Check for 'action' param first (preferred to avoid rewrite collision)
        let op = url.searchParams.get('action');

        const ops = url.searchParams.getAll('op');
        if (!op) {
            op = ops.find(o => ['start', 'status', 'process'].includes(o)) || ops.filter(o => o !== 'video-overview' && o !== 'media').pop() || '';
        }

        console.log(`[video-overview] Request URL: ${request.url}`);
        console.log(`[video-overview] Raw ops: ${JSON.stringify(ops)}, Detected op: '${op}'`);

        // Handle different operations
        switch (op) {
            case 'start': {
                // Queue a new job
                if (request.method !== 'POST') {
                    return errorResponse('Method not allowed', 405);
                }

                const authResult = await requireAuth(request);
                if (authResult instanceof Response) return authResult;

                // Log QStash configuration status
                console.log(`[video-overview] QStash configured: ${!!qstash}, QSTASH_TOKEN present: ${!!qstashToken}`);
                console.log(`[video-overview] Callback URL would be: ${buildQStashUrl('process')}`);

                try {
                    const body = (await request.json()) as OverviewRequest;
                    const projectId = (body.projectId || '').trim();
                    const prompt = (body.prompt || '').trim();
                    if (!projectId) return errorResponse('projectId is required', 400);
                    if (!prompt) return errorResponse('prompt is required', 400);

                    // Require QStash for this long-running operation
                    if (!qstash) {
                        console.error('[video-overview] QSTASH_TOKEN environment variable is not set');
                        return errorResponse('Video overview requires QSTASH_TOKEN to be configured. Please add it to your Vercel environment variables.', 500);
                    }

                    const jobId = generateJobId();
                    const job: VideoOverviewJob = {
                        id: jobId,
                        projectId: body.projectId || '', // Top-level for querying
                        status: 'queued',
                        request: body,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };

                    await saveJob(job);

                    // Queue processing via QStash
                    try {
                        const qstashUrl = buildQStashUrl('process');
                        console.log(`[video-overview] Publishing job ${jobId} to QStash at ${qstashUrl}`);

                        // Build headers with bypass token if available
                        const headers: Record<string, string> = {};
                        if (vercelBypassToken) {
                            headers['x-vercel-protection-bypass'] = vercelBypassToken;
                            console.log('[video-overview] Added x-vercel-protection-bypass header to initial QStash request');
                        }

                        await qstash.publishJSON({
                            url: qstashUrl,
                            body: { jobId },
                            headers: Object.keys(headers).length > 0 ? headers : undefined,
                            retries: 2,
                        });
                        console.log(`[video-overview] Successfully queued job ${jobId} via QStash`);
                    } catch (qstashError: any) {
                        console.error(`[video-overview] QStash publish failed:`, qstashError?.message || qstashError);
                        // Update job status to failed
                        await updateJobStatus(jobId, 'failed', `QStash error: ${qstashError?.message || 'Unknown error'}`);
                        return errorResponse(`Failed to queue job: ${qstashError?.message || 'QStash error'}`, 500);
                    }

                    // Return job ID immediately (job is now queued in QStash)
                    return json({ jobId, status: 'queued' });
                } catch (error: any) {
                    console.error('[video-overview] Error starting job:', error);
                    return errorResponse(error?.message || 'Failed to start video overview job', 500);
                }
            }

            case 'status': {
                // Poll job status
                const jobId = url.searchParams.get('jobId') || '';
                if (!jobId) return errorResponse('jobId is required', 400);

                const job = await getJob(jobId);
                if (!job) return errorResponse('Job not found', 404);

                return json({
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress,
                    result: job.result,
                    error: job.error,
                });
            }

            case 'list': {
                // List in-progress jobs for a project
                const projectId = url.searchParams.get('projectId') || '';
                if (!projectId) return errorResponse('projectId is required', 400);

                const jobs = await listProjectJobs(projectId);
                return json(jobs.map(job => ({
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress,
                    createdAt: job.createdAt,
                })));
            }

            case 'process': {
                // QStash callback to do the actual work
                if (request.method !== 'POST') {
                    return errorResponse('Method not allowed', 405);
                }

                // Note: QStash callbacks skip auth - they're verified by QStash signatures
                try {
                    const body = await request.json() as ProcessPayload;
                    console.log(`[video-overview] Process callback body:`, JSON.stringify(body));

                    const { jobId, step, imageIndex } = body;
                    if (!jobId) {
                        console.error('[video-overview] Missing jobId in process request');
                        return errorResponse('jobId is required', 400);
                    }

                    console.log(`[video-overview] Processing step ${step || 'INIT'} for job ${jobId}`);
                    await processVideoOverviewJob(body);
                    return json({ success: true });
                } catch (error: any) {
                    console.error('[video-overview] Error processing job:', error);
                    return errorResponse(error?.message || 'Failed to process job', 500);
                }
            }

            default: {
                console.warn(`[video-overview] Unknown operation: '${op}' (Raw ops: ${JSON.stringify(ops)})`);
                return errorResponse(`Unknown operation: '${op}'. Valid operations are: start, status, process. Debug: ops=${JSON.stringify(ops)}`, 400);
            }
        }
    },
};
