import type { GenerateProvider } from './base.js'
import { NanoBananaProvider } from './nanobanana.js'

// 2026-05-14 — Jimeng (火山 Visual) and Dreamina CLI removed. OpenRouter is
// the sole gateway: NanoBanana for image (openai/gpt-5.4-image-2 default),
// and the modern `src/server/providers/seedance.ts` for video. Users opt
// in by supplying an OpenRouter API key in Settings.

const providers = new Map<string, GenerateProvider>()

export function registerProvider(p: GenerateProvider) { providers.set(p.name, p) }
export function getProvider(name: string) { return providers.get(name) }

export function getDefaultProvider(type: 'image' | 'video') {
  for (const p of providers.values()) {
    if (type === 'image' && p.supportsImage) return p
    if (type === 'video' && p.supportsVideo) return p
  }
}

export function listProviders() {
  return [...providers.values()].map(p => ({ name: p.name, image: p.supportsImage, video: p.supportsVideo }))
}

export async function initProviders(config: { openrouter?: { apiKey?: string } }) {
  if (config.openrouter?.apiKey) {
    registerProvider(new NanoBananaProvider(config.openrouter.apiKey))
  }
}
