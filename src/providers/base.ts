export interface ImageOpts {
  prompt: string
  width?: number
  height?: number
  referenceImage?: string
  workId: string
  filename: string
  // OpenRouter image_config
  aspectRatio?: string
  imageSize?: string
  seed?: number
  temperature?: number
  model?: string
}

export interface GenerateResult {
  success: boolean
  assetPath?: string
  previewUrl?: string
  error?: string
  code?: 'TIMEOUT' | 'API_ERROR' | 'DOWNLOAD_FAILED' | 'INVALID_PARAMS'
}

// Image-capability provider contract. ADR-007 dropped the supportsImage /
// supportsVideo boolean flags + the unused generateVideo() leg — capability is
// a single tag on the registry entry now, and video providers implement the
// separate VideoProvider contract under src/providers/video/.
export interface GenerateProvider {
  name: string
  generateImage(opts: ImageOpts): Promise<GenerateResult>
}
