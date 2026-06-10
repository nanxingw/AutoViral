// width/height used to be SILENTLY dropped by the image provider — the
// public /api/generate/image params advertised width?/height? but only
// aspectRatio/imageSize reached the OpenRouter payload, so every such call
// fell back to the model's 1024×1024 default ("images can only be square").
// deriveAspectRatio turns width/height into the closest supported ratio so
// the documented params express intent.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { deriveAspectRatio, OpenRouterImageProvider } from './openrouter-image.js'

describe('deriveAspectRatio', () => {
  it('maps portrait 1080×1920 to 9:16', () => {
    expect(deriveAspectRatio(1080, 1920)).toBe('9:16')
  })

  it('maps landscape 1920×1080 to 16:9', () => {
    expect(deriveAspectRatio(1920, 1080)).toBe('16:9')
  })

  it('maps square to 1:1 and near-square to the closest ratio', () => {
    expect(deriveAspectRatio(1024, 1024)).toBe('1:1')
    expect(deriveAspectRatio(1080, 1350)).toBe('4:5') // IG portrait
  })

  it('returns undefined when either side is missing or invalid (model default)', () => {
    expect(deriveAspectRatio(undefined, 1920)).toBeUndefined()
    expect(deriveAspectRatio(1080, undefined)).toBeUndefined()
    expect(deriveAspectRatio(0, 100)).toBeUndefined()
    expect(deriveAspectRatio(100, -5)).toBeUndefined()
  })
})

describe('OpenRouterImageProvider — width/height reach the payload as aspect_ratio', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function captureFetch() {
    const calls: any[] = []
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body))
      // Short-circuit after the payload is captured — we only assert the request.
      return { ok: false, status: 500, text: async () => 'stub' } as any
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  it('derives image_config.aspect_ratio from width/height when aspectRatio absent', async () => {
    const calls = captureFetch()
    const p = new OpenRouterImageProvider('sk-test')
    await p.generateImage({
      prompt: 'a poster',
      workId: 'w1',
      filename: 'assets/images/x.png',
      width: 1080,
      height: 1920,
    } as any)
    expect(calls[0].image_config).toEqual({ aspect_ratio: '9:16' })
  })

  it('explicit aspectRatio wins over width/height', async () => {
    const calls = captureFetch()
    const p = new OpenRouterImageProvider('sk-test')
    await p.generateImage({
      prompt: 'a poster',
      workId: 'w1',
      filename: 'assets/images/x.png',
      width: 1080,
      height: 1920,
      aspectRatio: '16:9',
    } as any)
    expect(calls[0].image_config).toEqual({ aspect_ratio: '16:9' })
  })

  it('no size hints → no image_config (model default)', async () => {
    const calls = captureFetch()
    const p = new OpenRouterImageProvider('sk-test')
    await p.generateImage({
      prompt: 'a poster',
      workId: 'w1',
      filename: 'assets/images/x.png',
    } as any)
    expect(calls[0].image_config).toBeUndefined()
  })
})
