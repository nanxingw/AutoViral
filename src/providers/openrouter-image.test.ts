// width/height used to be SILENTLY dropped by the image provider — the
// public /api/generate/image params advertised width?/height? but only
// aspectRatio/imageSize reached the OpenRouter payload, so every such call
// fell back to the model's 1024×1024 default ("images can only be square").
// deriveAspectRatio turns width/height into the closest supported ratio so
// the documented params express intent.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { deriveAspectRatio, OpenRouterImageProvider } from './openrouter-image.js'

// B2 (PRD-0010) — the success path writes the decoded image to disk. These are
// unit tests, so stub the fs writes (we assert the request + the parsed cost,
// not the on-disk bytes). The deriveAspectRatio / width-height tests
// short-circuit with ok:false and never reach these.
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}))

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

// B2 (PRD-0010) — the image request must ask OpenRouter for usage accounting
// (usage:{include:true}) so we can book the REAL metered cost. When the response
// carries usage.cost we book it as-is (estimated:false); when it doesn't, we
// degrade to a flat estimate flagged estimated:true (honesty discipline).
describe('OpenRouterImageProvider — usage cost accounting (B2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Stub a SUCCESS response carrying an inline base64 image, optionally with a
   *  `usage` block. Returns an accessor for the captured request body. */
  function stubSuccess(usage?: unknown) {
    let captured: any
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
              },
            },
          ],
          ...(usage !== undefined ? { usage } : {}),
        }),
      } as any
    })
    vi.stubGlobal('fetch', fetchMock)
    return { body: () => captured }
  }

  it('sends usage.include:true in the request payload', async () => {
    const cap = stubSuccess({ cost: 0.037 })
    const p = new OpenRouterImageProvider('sk-test')
    await p.generateImage({ prompt: 'x', workId: 'w1', filename: 'a.png' } as any)
    expect(cap.body().usage).toEqual({ include: true })
  })

  it('parses usage.cost into costUsd with estimated:false', async () => {
    stubSuccess({ cost: 0.037 })
    const p = new OpenRouterImageProvider('sk-test')
    const r = await p.generateImage({ prompt: 'x', workId: 'w1', filename: 'a.png' } as any)
    expect(r.success).toBe(true)
    expect(r.costUsd).toBeCloseTo(0.037, 6)
    expect(r.estimated).toBe(false)
  })

  it('degrades to a flat estimate (estimated:true) when the response has no cost', async () => {
    stubSuccess(undefined) // no usage block at all
    const p = new OpenRouterImageProvider('sk-test')
    const r = await p.generateImage({ prompt: 'x', workId: 'w1', filename: 'a.png' } as any)
    expect(r.success).toBe(true)
    expect(r.estimated).toBe(true)
    expect(r.costUsd).toBeGreaterThan(0)
  })

  it('degrades to estimated when usage exists but carries no numeric cost', async () => {
    stubSuccess({ prompt_tokens: 10, completion_tokens: 0 }) // usage without cost
    const p = new OpenRouterImageProvider('sk-test')
    const r = await p.generateImage({ prompt: 'x', workId: 'w1', filename: 'a.png' } as any)
    expect(r.success).toBe(true)
    expect(r.estimated).toBe(true)
    expect(r.costUsd).toBeGreaterThan(0)
  })
})
