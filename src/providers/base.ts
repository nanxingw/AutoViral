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
  duration?: number       // 4-15 seconds (Dreamina CLI)
  modelVersion?: string   // e.g. 'seedance2.0', 'seedance2.0fast'
  workId: string
  filename: string
}

export interface LipSyncOpts {
  videoUrl: string         // URL of the source video
  audioUrl: string         // URL of the audio to lip-sync to
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
  supportsLipSync?: boolean
  generateImage(opts: ImageOpts): Promise<GenerateResult>
  generateVideo(opts: VideoOpts): Promise<GenerateResult>
  lipSync?(opts: LipSyncOpts): Promise<GenerateResult>
}
