import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../config.js';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-3-pro-image-preview';
export class NanoBananaProvider {
    name = 'nanobanana';
    supportsImage = true;
    supportsVideo = false;
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async generateImage(opts) {
        const { prompt, workId, filename } = opts;
        try {
            const res = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3271',
                },
                body: JSON.stringify({
                    model: MODEL,
                    modalities: ['text', 'image'],
                    messages: [
                        {
                            role: 'user',
                            content: [{ type: 'text', text: prompt }],
                        },
                    ],
                }),
            });
            if (!res.ok) {
                const errBody = await res.text();
                return { success: false, error: `OpenRouter API error ${res.status}: ${errBody}`, code: 'API_ERROR' };
            }
            const data = await res.json();
            const message = data.choices?.[0]?.message;
            const content = message?.content;
            const images = message?.images;
            // Extract base64 image data from response
            // OpenRouter may return images in message.images[] or message.content
            let base64Data = null;
            let mimeType = 'image/png';
            // Check message.images array first (OpenRouter Gemini image generation format)
            if (Array.isArray(images)) {
                for (const img of images) {
                    const url = img?.image_url?.url ?? img?.url;
                    if (url) {
                        const match = url.match(/data:(image\/[^;]+);base64,(.+)/);
                        if (match) {
                            mimeType = match[1];
                            base64Data = match[2];
                            break;
                        }
                    }
                    if (img?.source?.data) {
                        base64Data = img.source.data;
                        mimeType = img.source.media_type ?? 'image/png';
                        break;
                    }
                }
            }
            // Fall back to content field
            if (!base64Data && typeof content === 'string') {
                const match = content.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
                if (match) {
                    mimeType = match[1];
                    base64Data = match[2];
                }
            }
            if (!base64Data && Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'image_url' && part.image_url?.url) {
                        const match = part.image_url.url.match(/data:(image\/[^;]+);base64,(.+)/);
                        if (match) {
                            mimeType = match[1];
                            base64Data = match[2];
                            break;
                        }
                    }
                    if (part.type === 'image' && part.source?.data) {
                        base64Data = part.source.data;
                        mimeType = part.source.media_type ?? 'image/png';
                        break;
                    }
                    if (part.type === 'text' && typeof part.text === 'string') {
                        const textMatch = part.text.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
                        if (textMatch) {
                            mimeType = textMatch[1];
                            base64Data = textMatch[2];
                            break;
                        }
                    }
                }
            }
            if (!base64Data) {
                return { success: false, error: 'No image data found in response', code: 'API_ERROR' };
            }
            const buffer = Buffer.from(base64Data, 'base64');
            const assetPath = join(dataDir, 'works', workId, 'assets', 'images', filename);
            const dir = assetPath.substring(0, assetPath.lastIndexOf('/'));
            await mkdir(dir, { recursive: true });
            await writeFile(assetPath, buffer);
            return {
                success: true,
                assetPath,
                previewUrl: `/api/works/${workId}/assets/images/${filename}`,
            };
        }
        catch (err) {
            return { success: false, error: err.message, code: 'API_ERROR' };
        }
    }
    async generateVideo(_opts) {
        return {
            success: false,
            error: 'NanoBanana provider does not support video generation',
            code: 'INVALID_PARAMS',
        };
    }
}
//# sourceMappingURL=nanobanana.js.map