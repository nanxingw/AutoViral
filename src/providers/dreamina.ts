import { execFile } from 'node:child_process'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { promisify } from 'node:util'
import { dataDir } from '../config.js'
import type { GenerateProvider, ImageOpts, VideoOpts, GenerateResult } from './base.js'

const execFileAsync = promisify(execFile)

const POLL_TIMEOUT = 120 // seconds

// ── Helpers ────────────────────────────────────────────────────────────────

async function runDreamina(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('dreamina', args, { timeout: (POLL_TIMEOUT + 30) * 1000 })
}

function parseResult(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout)
  } catch {
    // Some commands output non-JSON; try to extract JSON from the output
    const match = stdout.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error(`Failed to parse dreamina output: ${stdout.slice(0, 200)}`)
  }
}

/** Move the first media file matching an extension from srcDir to destPath */
async function moveDownloadedFile(downloadDir: string, destPath: string, extensions: string[]): Promise<void> {
  const files = await readdir(downloadDir)
  const match = files.find(f => extensions.includes(extname(f).toLowerCase()))
  if (!match) throw new Error(`No file with extensions ${extensions.join(',')} found in ${downloadDir}`)
  const dir = destPath.substring(0, destPath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await rename(join(downloadDir, match), destPath)
}

// ── DreaminaProvider ───────────────────────────────────────────────────────

export class DreaminaProvider implements GenerateProvider {
  readonly name = 'dreamina'
  readonly supportsImage = true
  readonly supportsVideo = true

  async generateImage(opts: ImageOpts): Promise<GenerateResult> {
    const { prompt, workId, filename } = opts

    try {
      const args = ['text2image', `--prompt=${prompt}`, `--poll=${POLL_TIMEOUT}`]

      if (opts.aspectRatio) args.push(`--ratio=${opts.aspectRatio}`)
      args.push('--resolution_type=2k')

      const { stdout } = await runDreamina(args)
      const result = parseResult(stdout)

      const genStatus = result.gen_status as string | undefined
      const submitId = result.submit_id as string | undefined

      if (genStatus === 'fail') {
        return { success: false, error: `Generation failed: ${result.fail_reason ?? 'unknown'}`, code: 'API_ERROR' }
      }

      if (genStatus === 'success' && submitId) {
        // Download the result
        const tmpDir = join(dataDir, 'tmp', `dreamina-${submitId}`)
        await mkdir(tmpDir, { recursive: true })
        await runDreamina(['query_result', `--submit_id=${submitId}`, `--download_dir=${tmpDir}`])

        const assetPath = join(dataDir, 'works', workId, 'assets', 'images', filename)
        await moveDownloadedFile(tmpDir, assetPath, ['.png', '.jpg', '.jpeg', '.webp'])

        return {
          success: true,
          assetPath,
          previewUrl: `/api/works/${workId}/assets/images/${filename}`,
        }
      }

      // Still querying — return submit_id for later follow-up
      return { success: false, error: `Task still processing (submit_id: ${submitId})`, code: 'TIMEOUT' }
    } catch (err: any) {
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }

  async generateVideo(opts: VideoOpts): Promise<GenerateResult> {
    const { prompt, workId, filename } = opts
    const duration = opts.duration ?? 5
    const modelVersion = opts.modelVersion ?? 'seedance2.0fast'

    try {
      let args: string[]

      if (opts.firstFrame && opts.lastFrame) {
        // frames2video: first + last frame
        args = [
          'frames2video',
          `--first=${opts.firstFrame}`,
          `--last=${opts.lastFrame}`,
          `--prompt=${prompt}`,
          `--duration=${duration}`,
          `--model_version=${modelVersion}`,
          `--poll=${POLL_TIMEOUT}`,
        ]
      } else if (opts.firstFrame) {
        // image2video: single first frame
        args = [
          'image2video',
          `--image=${opts.firstFrame}`,
          `--prompt=${prompt}`,
          `--duration=${duration}`,
          `--model_version=${modelVersion}`,
          `--poll=${POLL_TIMEOUT}`,
        ]
      } else {
        // text2video: no image input
        args = [
          'text2video',
          `--prompt=${prompt}`,
          `--duration=${duration}`,
          `--model_version=${modelVersion}`,
          `--poll=${POLL_TIMEOUT}`,
        ]
        if (opts.resolution) args.push(`--ratio=${opts.resolution}`)
      }

      const { stdout } = await runDreamina(args)
      const result = parseResult(stdout)

      const genStatus = result.gen_status as string | undefined
      const submitId = result.submit_id as string | undefined

      if (genStatus === 'fail') {
        return { success: false, error: `Generation failed: ${result.fail_reason ?? 'unknown'}`, code: 'API_ERROR' }
      }

      if (genStatus === 'success' && submitId) {
        const tmpDir = join(dataDir, 'tmp', `dreamina-${submitId}`)
        await mkdir(tmpDir, { recursive: true })
        await runDreamina(['query_result', `--submit_id=${submitId}`, `--download_dir=${tmpDir}`])

        const assetPath = join(dataDir, 'works', workId, 'assets', 'clips', filename)
        await moveDownloadedFile(tmpDir, assetPath, ['.mp4', '.webm', '.mov'])

        return {
          success: true,
          assetPath,
          previewUrl: `/api/works/${workId}/assets/clips/${filename}`,
        }
      }

      return { success: false, error: `Task still processing (submit_id: ${submitId})`, code: 'TIMEOUT' }
    } catch (err: any) {
      if (err.message?.includes('timed out')) {
        return { success: false, error: err.message, code: 'TIMEOUT' }
      }
      return { success: false, error: err.message, code: 'API_ERROR' }
    }
  }
}

/** Check if dreamina CLI is installed and logged in */
export async function isDreaminaAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('dreamina', ['user_credit'], { timeout: 10000 })
    const result = JSON.parse(stdout)
    return typeof result.credit === 'number' || typeof result.remaining === 'number'
  } catch {
    return false
  }
}
