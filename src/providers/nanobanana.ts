import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from '../config.js'
import type { GenerateProvider, ImageOpts, VideoOpts, GenerateResult } from './base.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview'

export class NanoBananaProvider implements GenerateProvider {
  readonly name = 'nanobanana'
  readonly supportsImage = true
  readonly supportsVideo = false

  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generateImage(opts: ImageOpts): Promise<GenerateResult> {
    const { prompt, workId, filename, referenceImage, aspectRatio, imageSize, seed, temperature, model } = opts

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

  async generateVideo(_opts: VideoOpts): Promise<GenerateResult> {
    return {
      success: false,
      error: 'NanoBanana provider does not support video generation',
      code: 'INVALID_PARAMS',
    }
  }
}
