import { JimengProvider } from './jimeng.js';
import { NanoBananaProvider } from './nanobanana.js';
const providers = new Map();
export function registerProvider(p) { providers.set(p.name, p); }
export function getProvider(name) { return providers.get(name); }
export function getDefaultProvider(type) {
    for (const p of providers.values()) {
        if (type === 'image' && p.supportsImage)
            return p;
        if (type === 'video' && p.supportsVideo)
            return p;
    }
}
export function listProviders() {
    return [...providers.values()].map(p => ({ name: p.name, image: p.supportsImage, video: p.supportsVideo }));
}
export function initProviders(config) {
    if (config.jimeng?.accessKey)
        registerProvider(new JimengProvider(config.jimeng));
    if (config.openrouter?.apiKey)
        registerProvider(new NanoBananaProvider(config.openrouter.apiKey));
}
//# sourceMappingURL=registry.js.map