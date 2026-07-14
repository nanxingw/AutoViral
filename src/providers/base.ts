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
  /** S10 (PRD-0014) — request-abort signal; the route passes c.req.raw.signal so
   *  a client disconnect cancels the in-flight image generation. */
  signal?: AbortSignal
}

export interface GenerateResult {
  success: boolean
  assetPath?: string
  previewUrl?: string
  error?: string
  code?: 'TIMEOUT' | 'API_ERROR' | 'DOWNLOAD_FAILED' | 'INVALID_PARAMS'
  // B2 (PRD-0010) — cost accounting. costUsd is the USD charge for a successful
  // generation: the REAL metered figure OpenRouter returns via usage.cost when
  // available, otherwise a flat estimate. `estimated` tells the ledger which one
  // it is (honesty discipline — never present an estimate as a metered charge).
  costUsd?: number
  estimated?: boolean
}

// Image-capability provider contract. ADR-007 dropped the supportsImage /
// supportsVideo boolean flags + the unused generateVideo() leg — capability is
// a single tag on the registry entry now, and video providers implement the
// separate VideoProvider contract under src/providers/video/.
export interface GenerateProvider {
  name: string
  generateImage(opts: ImageOpts): Promise<GenerateResult>
}
