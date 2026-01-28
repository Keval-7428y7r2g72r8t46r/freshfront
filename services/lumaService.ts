
export interface LumaModifyRequest {
    media: { url: string };
    first_frame?: { url: string };
    model: 'ray-2' | 'ray-flash-2';
    mode: 'adhere_1' | 'adhere_2' | 'adhere_3' | 'flex_1' | 'flex_2' | 'flex_3' | 'reimagine_1' | 'reimagine_2' | 'reimagine_3';
    prompt: string;
    callback_url?: string;
}

export interface LumaGenerationResponse {
    id: string;
    state: 'queued' | 'dreaming' | 'completed' | 'failed';
    failure_reason?: string;
    assets?: {
        video?: string;
        image?: string;
        progress_video?: string;
        first_frame?: string;
    };
    created_at: string;
    generation_type: string;
    request?: any;
}

const LUMA_API_URL = 'https://api.lumalabs.ai/dream-machine/v1/generations';

const getApiKey = () => {
    const key = import.meta.env.VITE_LUMA_API_KEY;
    if (!key) {
        console.warn('VITE_LUMA_API_KEY is missing');
    }
    return key;
};

export const lumaService = {
    /**
     * Modify a video using Luma Dream Machine
     */
    modifyVideo: async (params: LumaModifyRequest): Promise<LumaGenerationResponse> => {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Luma API Key is missing. Please set VITE_LUMA_API_KEY.');

        const response = await fetch(`${LUMA_API_URL}/video/modify`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                generation_type: 'modify_video',
                ...params
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Luma API Error (${response.status}): ${errorText}`);
        }

        return response.json();
    },

    /**
     * Get generation status
     */
    getGeneration: async (id: string): Promise<LumaGenerationResponse> => {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Luma API Key is missing');

        const response = await fetch(`${LUMA_API_URL}/${id}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            // If 404, might be expired or wrong ID
            if (response.status === 404) {
                throw new Error('Generation not found');
            }
            const errorText = await response.text();
            throw new Error(`Luma API Error (${response.status}): ${errorText}`);
        }

        return response.json();
    }
};
