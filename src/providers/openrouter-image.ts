import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from '../infra/config.js'
import type { GenerateProvider, ImageOpts, GenerateResult } from './base.js'

// Image generation via the OpenRouter chat-completions gateway; the default
// model is gpt-5.4-image-2 (see DEFAULT_MODEL), overridable per request. File,
// class and registry id were renamed from the historical "nanobanana" (a
// pre-model-switch product name that no longer described what runs);
// "nanobanana" survives only as an inbound alias at the registry lookup
// (registry.ts PROVIDER_ID_ALIASES) so old docs / chat history keep working.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'openai/gpt-5.4-image-2'

// Aspect ratios the OpenRouter image_config accepts. Callers that pass raw
// width/height (the documented public params on /api/generate/image) used to
// be SILENTLY ignored — the model fell back to its 1024×1024 default and the
// agent concluded "images can only be square". Derive the closest supported
// ratio instead so width/height express intent even though the model picks
// the actual pixel dimensions.
const SUPPORTED_RATIOS: ReadonlyArray<readonly [string, number]> = [
  ['1:1', 1],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['21:9', 21 / 9],
]

// C1.2 (PRD-0009) — the authoritative aspect_ratio enum the OpenRouter
// image_config accepts. Exported so POST /api/generate/image can reject an
// illegal aspectRatio LOCALLY (before forwarding to a paid model that 400s with
// an error body leaking the internal model/account id). Single source of truth:
// derived from SUPPORTED_RATIOS so the route and the provider can never drift.
export const SUPPORTED_IMAGE_ASPECT_RATIOS: readonly string[] = SUPPORTED_RATIOS.map(
  ([label]) => label,
)

/** Closest supported aspect-ratio string for a width×height request, or
 *  undefined when either side is missing/invalid (model default applies). */
export function deriveAspectRatio(
  width?: number,
  height?: number,
): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined
  const target = width / height
  let best: string | undefined
  let bestDist = Infinity
  for (const [label, ratio] of SUPPORTED_RATIOS) {
    const dist = Math.abs(Math.log(target / ratio))
    if (dist < bestDist) {
      bestDist = dist
      best = label
    }
  }
  return best
}

export class OpenRouterImageProvider implements GenerateProvider {
  readonly name = 'openrouter-image'

  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generateImage(opts: ImageOpts): Promise<GenerateResult> {
    const { prompt, workId, filename, referenceImage, imageSize, seed, temperature, model, width, height } = opts
    // Explicit aspectRatio wins; otherwise derive it from width/height so
    // those params are honored as intent rather than silently dropped.
    const aspectRatio = opts.aspectRatio ?? deriveAspectRatio(width, height)

    try {
      // Build message content
      const contentParts: any[] = []

      // Add reference image if provided
      if (referenceImage) {
        if (referenceImage.startsWith('data:')) {
          contentParts.push({ type: 'image_url', image_url: { url: referenceImage } })
        } else if (referenceImage.startsWith('http')) {
          contentParts.push({ type: 'image_url', image_url: { url: referenceImage } })
        }
      }

      contentParts.push({ type: 'text', text: prompt })

      // Build request payload
      const payload: any = {
        model: model || DEFAULT_MODEL,
        modalities: ['text', 'image'],
        messages: [{ role: 'user', content: contentParts }],
      }

      // image_config for aspect ratio and resolution
      const imageConfig: any = {}
      if (aspectRatio) imageConfig.aspect_ratio = aspectRatio
      if (imageSize) imageConfig.image_size = imageSize
      if (Object.keys(imageConfig).length > 0) payload.image_config = imageConfig

      // Optional parameters
      if (seed !== undefined) payload.seed = seed
      if (temperature !== undefined) payload.temperature = temperature

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3271',
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errBody = await res.text()
        return { success: false, error: `OpenRouter API error ${res.status}: ${errBody}`, code: 'API_ERROR' }
      }

      const data = await res.json() as any

      if (data.error) {
        return { success: false, error: `OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`, code: 'API_ERROR' }
      }

      const base64Data = this.extractBase64(data)

      if (!base64Data) {
        return { success: false, error: 'No image data found in response', code: 'API_ERROR' }
      }

      const buffer = Buffer.from(base64Data, 'base64')
      const assetPath = join(dataDir, 'works', workId, 'assets', 'images', filename)
      const dir = assetPath.substring(0, assetPath.lastIndexOf('/'))
      await mkdir(dir, { recursive: true })
      await writeFile(assetPath, buffer)

      return {
        success: true,
        assetPath,
        previewUrl: `/api/works/${workId}/assets/images/${filename}`,
      }
    } catch (err: any) {
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }

  private extractBase64(data: any): string | null {
    const message = data.choices?.[0]?.message
    const content = message?.content
    const images = message?.images

    // Check message.images array first
    if (Array.isArray(images)) {
      for (const img of images) {
        const url = img?.image_url?.url ?? img?.url
        if (url) {
          const match = url.match(/data:image\/[^;]+;base64,(.+)/)
          if (match) return match[1]
        }
        if (img?.source?.data) return img.source.data
      }
    }

    // Fall back to content string
    if (typeof content === 'string') {
      const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/)
      if (match) return match[1]
    }

    // Fall back to content array
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image_url' && part.image_url?.url) {
          const match = part.image_url.url.match(/data:image\/[^;]+;base64,(.+)/)
          if (match) return match[1]
        }
        if (part.type === 'image' && part.source?.data) return part.source.data
        if (part.type === 'text' && typeof part.text === 'string') {
          const m = part.text.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/)
          if (m) return m[1]
        }
      }
    }

    return null
  }
}
