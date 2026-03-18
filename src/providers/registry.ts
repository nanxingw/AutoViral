import type { GenerateProvider } from './base.js'
import { JimengProvider } from './jimeng.js'

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

export function initProviders(config: any) {
  if (config.jimeng?.accessKey) registerProvider(new JimengProvider(config.jimeng))
}
