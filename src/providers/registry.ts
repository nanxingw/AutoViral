import type { GenerateProvider } from './base.js'
import { DreaminaProvider, isDreaminaAvailable } from './dreamina.js'
import { JimengProvider } from './jimeng.js'
import { NanoBananaProvider } from './nanobanana.js'

const providers = new Map<string, GenerateProvider>()

export function registerProvider(p: GenerateProvider) { providers.set(p.name, p) }
export function getProvider(name: string) { return providers.get(name) }

export function getDefaultProvider(type: 'image' | 'video') {
  if (type === 'video') {
    // Video: prefer Dreamina CLI, then fall back to others
    const dreamina = providers.get('dreamina')
    if (dreamina) return dreamina
  }
  if (type === 'image') {
    // Image: prefer OpenRouter/Gemini, skip Dreamina
    for (const p of providers.values()) {
      if (p.supportsImage && p.name !== 'dreamina') return p
    }
  }
  for (const p of providers.values()) {
    if (type === 'image' && p.supportsImage) return p
    if (type === 'video' && p.supportsVideo) return p
  }
}

export function listProviders() {
  return [...providers.values()].map(p => ({ name: p.name, image: p.supportsImage, video: p.supportsVideo }))
}

export async function initProviders(config: any) {
  // Dreamina CLI — preferred for video, check if logged in
  if (await isDreaminaAvailable()) {
    registerProvider(new DreaminaProvider())
  }
  if (config.jimeng?.accessKey) registerProvider(new JimengProvider(config.jimeng))
  if (config.openrouter?.apiKey) registerProvider(new NanoBananaProvider(config.openrouter.apiKey))
}
