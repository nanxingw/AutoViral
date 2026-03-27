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

export interface VideoOpts {
  prompt: string
  firstFrame?: string
  lastFrame?: string
  resolution?: string
  workId: string
  filename: string
}

export interface GenerateResult {
  success: boolean
  assetPath?: string
  previewUrl?: string
  error?: string
  code?: 'TIMEOUT' | 'API_ERROR' | 'DOWNLOAD_FAILED' | 'INVALID_PARAMS'
}

export interface GenerateProvider {
  name: string
  supportsImage: boolean
  supportsVideo: boolean
  generateImage(opts: ImageOpts): Promise<GenerateResult>
  generateVideo(opts: VideoOpts): Promise<GenerateResult>
}
