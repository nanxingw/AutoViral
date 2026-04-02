import { createHmac, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from '../config.js'
import type { GenerateProvider, ImageOpts, VideoOpts, LipSyncOpts, GenerateResult } from './base.js'

// ── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://visual.volcengineapi.com'
const REGION = 'cn-north-1'
const SERVICE = 'cv'
const API_VERSION = '2022-08-31'
const SUBMIT_ACTION = 'CVSync2AsyncSubmitTask'
const QUERY_ACTION = 'CVSync2AsyncGetResult'
// Lip-sync uses a different action pair
const LIPSYNC_SUBMIT_ACTION = 'CVSubmitTask'
const LIPSYNC_QUERY_ACTION = 'CVGetResult'
const LIPSYNC_REQ_KEY = 'realman_change_lips'

const IMAGE_REQ_KEY = 'jimeng_t2i_v40'
// Video 3.0 Pro req_keys (new API format with req_json wrapper)
const VIDEO_T2V_REQ_KEY = 'ImageGenerationTextToVideo'
const VIDEO_I2V_REQ_KEY = 'ImageGenerationImageToVideo'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// ── Volcengine HMAC-SHA256 Signing (AWS SigV4-style) ────────────────────────

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function hmacSha256Hex(key: string | Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex')
}

function getISODate(): { timestamp: string; dateStamp: string } {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = timestamp.slice(0, 8)
  return { timestamp, dateStamp }
}

interface SignedRequest {
  url: string
  headers: Record<string, string>
  body: string
}

function signRequest(
  accessKey: string,
  secretKey: string,
  action: string,
  payload: string,
): SignedRequest {
  const { timestamp, dateStamp } = getISODate()
  const host = 'visual.volcengineapi.com'
  const contentType = 'application/json'
  const payloadHash = sha256(payload)

  // Query string (sorted)
  const queryParams = `Action=${action}&Version=${API_VERSION}`

  // Canonical headers (must be sorted by lowercase header name)
  // Note: content-type is excluded from signing per Volcengine spec
  const canonicalHeaders = [
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${timestamp}`,
  ].join('\n') + '\n'

  const signedHeaders = 'host;x-content-sha256;x-date'

  // Step 1: Create canonical request
  const canonicalRequest = [
    'POST',
    '/',
    queryParams,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  // Step 2: Create string to sign
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/request`
  const stringToSign = [
    'HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')

  // Step 3: Calculate signing key
  const kDate = hmacSha256(secretKey, dateStamp)
  const kRegion = hmacSha256(kDate, REGION)
  const kService = hmacSha256(kRegion, SERVICE)
  const kSigning = hmacSha256(kService, 'request')

  // Step 4: Calculate signature
  const signature = hmacSha256Hex(kSigning, stringToSign)

  // Step 5: Build authorization header
  const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: `${BASE_URL}/?${queryParams}`,
    headers: {
      'Content-Type': contentType,
      'Host': host,
      'X-Date': timestamp,
      'X-Content-Sha256': payloadHash,
      'Authorization': authorization,
    },
    body: payload,
  }
}

// ── Polling helper ──────────────────────────────────────────────────────────

async function submitAndPoll(
  accessKey: string,
  secretKey: string,
  submitPayload: Record<string, unknown>,
  submitAction = SUBMIT_ACTION,
  queryAction = QUERY_ACTION,
): Promise<{ data: any }> {
  // Submit task
  const submitBody = JSON.stringify(submitPayload)
  const submitReq = signRequest(accessKey, secretKey, submitAction, submitBody)
  const submitRes = await fetch(submitReq.url, {
    method: 'POST',
    headers: submitReq.headers,
    body: submitReq.body,
  })
  const submitData = await submitRes.json() as any
  if (submitData.code && submitData.code !== 10000 && submitData.code !== 0) {
    throw new Error(`Submit failed: ${submitData.message ?? JSON.stringify(submitData)}`)
  }

  const taskId = submitData.data?.task_id
  if (!taskId) {
    // Some endpoints return result directly
    if (submitData.data) return { data: submitData.data }
    throw new Error(`No task_id in response: ${JSON.stringify(submitData)}`)
  }

  // Poll for result
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

    const queryPayload = JSON.stringify({ req_key: submitPayload.req_key, task_id: taskId })
    const queryReq = signRequest(accessKey, secretKey, queryAction, queryPayload)
    const queryRes = await fetch(queryReq.url, {
      method: 'POST',
      headers: queryReq.headers,
      body: queryReq.body,
    })
    const queryData = await queryRes.json() as any

    const status = queryData.data?.status
    if (status === 'done' || status === 'SUCCESS') {
      return { data: queryData.data }
    }
    if (status === 'failed' || status === 'FAILED') {
      throw new Error(`Task failed: ${queryData.data?.message ?? JSON.stringify(queryData)}`)
    }
    // Still processing, continue polling
  }

  throw new Error('Task timed out after 5 minutes')
}

// ── Download helper ─────────────────────────────────────────────────────────

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const dir = destPath.substring(0, destPath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(destPath, buffer)
}

// ── JimengProvider ──────────────────────────────────────────────────────────

export class JimengProvider implements GenerateProvider {
  readonly name = 'jimeng'
  readonly supportsImage = true
  readonly supportsVideo = true
  readonly supportsLipSync = true

  private accessKey: string
  private secretKey: string

  constructor(config: { accessKey: string; secretKey: string }) {
    this.accessKey = config.accessKey
    this.secretKey = config.secretKey
  }

  async generateImage(opts: ImageOpts): Promise<GenerateResult> {
    const { prompt, workId, filename } = opts
    const width = opts.width ?? 1088
    const height = opts.height ?? 1088

    // Clamp dimensions to valid range
    const clampedWidth = Math.min(1728, Math.max(576, width))
    const clampedHeight = Math.min(1728, Math.max(576, height))

    try {
      const payload: Record<string, unknown> = {
        req_key: IMAGE_REQ_KEY,
        prompt,
        width: clampedWidth,
        height: clampedHeight,
        return_url: true,
        logo_info: { add_logo: false },
      }

      if (opts.referenceImage) {
        payload.binary_data_base64 = [opts.referenceImage]
      }

      const result = await submitAndPoll(this.accessKey, this.secretKey, payload)

      // Extract image URL or base64 data from result
      const imageUrl = result.data?.image_urls?.[0]
        ?? result.data?.resp_data?.[0]?.image_url
      const imageBase64 = result.data?.binary_data_base64?.[0]

      const assetPath = join(dataDir, 'works', workId, 'assets', 'images', filename)

      if (imageUrl) {
        await downloadFile(imageUrl, assetPath)
      } else if (imageBase64) {
        // API returned raw base64 image data — write directly
        const dir = assetPath.substring(0, assetPath.lastIndexOf('/'))
        await mkdir(dir, { recursive: true })
        await writeFile(assetPath, Buffer.from(imageBase64, 'base64'))
      } else {
        return { success: false, error: 'No image URL or base64 data in response', code: 'API_ERROR' }
      }

      return {
        success: true,
        assetPath,
        previewUrl: `/api/works/${workId}/assets/images/${filename}`,
      }
    } catch (err: any) {
      if (err.message?.includes('timed out')) {
        return { success: false, error: err.message, code: 'TIMEOUT' }
      }
      if (err.message?.includes('Download failed')) {
        return { success: false, error: err.message, code: 'DOWNLOAD_FAILED' }
      }
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }

  async generateVideo(opts: VideoOpts): Promise<GenerateResult> {
    const { prompt, workId, filename } = opts

    try {
      const isImageToVideo = !!opts.firstFrame
      const reqKey = isImageToVideo ? VIDEO_I2V_REQ_KEY : VIDEO_T2V_REQ_KEY

      // Build req_json inner object per 3.0 Pro API spec
      const reqJson: Record<string, unknown> = {
        req_key: reqKey,
        prompt,
      }

      if (isImageToVideo && opts.firstFrame) {
        reqJson.image_url = opts.firstFrame
      }

      // Map resolution/aspect ratio (e.g. "16:9", "9:16", "1:1")
      if (opts.resolution) {
        reqJson.aspect_ratio = opts.resolution
      } else {
        reqJson.aspect_ratio = '9:16' // default vertical for Douyin/XHS
      }

      // Wrap in req_json string as the API expects
      const payload: Record<string, unknown> = {
        req_key: reqKey,
        req_json: JSON.stringify(reqJson),
      }

      const result = await submitAndPoll(this.accessKey, this.secretKey, payload)

      // Extract video URL from result
      const videoUrl = result.data?.video_url
        ?? result.data?.video_urls?.[0]
        ?? result.data?.resp_data?.[0]?.video_url

      if (!videoUrl) {
        return { success: false, error: 'No video URL in response', code: 'API_ERROR' }
      }

      const assetPath = join(dataDir, 'works', workId, 'assets', 'clips', filename)
      await downloadFile(videoUrl, assetPath)

      return {
        success: true,
        assetPath,
        previewUrl: `/api/works/${workId}/assets/clips/${filename}`,
      }
    } catch (err: any) {
      if (err.message?.includes('timed out')) {
        return { success: false, error: err.message, code: 'TIMEOUT' }
      }
      if (err.message?.includes('Download failed')) {
        return { success: false, error: err.message, code: 'DOWNLOAD_FAILED' }
      }
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }

  async lipSync(opts: LipSyncOpts): Promise<GenerateResult> {
    const { videoUrl, audioUrl, workId, filename } = opts

    try {
      const payload: Record<string, unknown> = {
        req_key: LIPSYNC_REQ_KEY,
        video_url: videoUrl,
        audio_url: audioUrl,
      }

      const result = await submitAndPoll(
        this.accessKey,
        this.secretKey,
        payload,
        LIPSYNC_SUBMIT_ACTION,
        LIPSYNC_QUERY_ACTION,
      )

      // Extract output video URL
      const outputUrl = result.data?.resp_data?.[0]?.url
        ?? result.data?.video_url
        ?? result.data?.video_urls?.[0]

      if (!outputUrl) {
        return { success: false, error: 'No video URL in lip-sync response', code: 'API_ERROR' }
      }

      const assetPath = join(dataDir, 'works', workId, 'assets', 'clips', filename)
      await downloadFile(outputUrl, assetPath)

      return {
        success: true,
        assetPath,
        previewUrl: `/api/works/${workId}/assets/clips/${filename}`,
      }
    } catch (err: any) {
      if (err.message?.includes('timed out')) {
        return { success: false, error: err.message, code: 'TIMEOUT' }
      }
      if (err.message?.includes('Download failed')) {
        return { success: false, error: err.message, code: 'DOWNLOAD_FAILED' }
      }
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }
}
