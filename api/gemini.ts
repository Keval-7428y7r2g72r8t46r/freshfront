import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const client = new GoogleGenAI({ apiKey });

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    const url = new URL(request.url);
    const op = (url.searchParams.get('op') || '').trim();

    if (!op) return error('Missing op parameter');

    if (op === 'chat') {
        if (request.method !== 'POST') return error('Method not allowed', 405);

        try {
            const body = await request.json();
            const { messages, model } = body;

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return error('Missing or invalid messages');
            }

            // Extract the last user message as prompt (simplification for single turn)
            // Or construct full history if needed.
            // Based on frontend code, it sends `[{ role: 'user', content: prompt }]`
            const lastMessage = messages[messages.length - 1];
            const prompt = lastMessage.content;

            if (!prompt) return error('Empty prompt');

            // Use specified model or fallback
            const modelName = model || 'gemini-2.0-flash';

            const response = await client.models.generateContent({
                model: modelName,
                contents: prompt,
            });

            const text = response.text;

            return json({ response: text });

        } catch (e: any) {
            console.error('Gemini chat failed:', e);
            return error(e.message || 'Gemini API failed', 500);
        }
    }

    return error('Operation not found', 404);
}
