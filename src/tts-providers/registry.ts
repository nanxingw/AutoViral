import { edgeTtsProvider } from "./edge-tts.js";
import { openaiTtsProvider } from "./openai-tts.js";
import type { TtsProvider, TtsRequest, TtsResult } from "./types.js";

export interface ProviderPickOptions {
  language?: string;
  preferQuality?: boolean;
}

const ALL_PROVIDERS: TtsProvider[] = [
  edgeTtsProvider,
  openaiTtsProvider,
  // elevenLabsProvider — Phase 3.x
  // volcanoTtsProvider — Phase 3.x
];

/**
 * Picks a TTS provider for a request. Today only edge-tts is available,
 * so all paths return it. When ElevenLabs/Volcano land, this fans out:
 *   - Chinese + voiceover style → Volcano (best zh prosody)
 *   - English + named-voice → ElevenLabs
 *   - Anything else → edge-tts (zero-cost fallback)
 */
export function pickProvider(_opts: ProviderPickOptions = {}): TtsProvider {
  return edgeTtsProvider;
}

export function getProviderById(id: string): TtsProvider | null {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? null;
}

async function isProviderAvailable(p: TtsProvider): Promise<boolean> {
  // Absent isAvailable → assume available (back-compat with providers that
  // never declared a probe).
  if (!p.isAvailable) return true;
  try {
    return await p.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Generates audio with edge-tts-first fallback semantics:
 *
 *   - provider:"auto" (default) → try edge-tts; if it is unavailable OR throws,
 *     try openai; if both fail, throw an aggregated error naming both failures.
 *   - provider:"edge-tts" → only edge-tts (no fallback).
 *   - provider:"openai"  → only openai.
 *
 * "available" means the provider's isAvailable() resolves true. An unavailable
 * provider is skipped without invoking generate(); a provider that becomes
 * available but throws at generate() time still triggers the fallback in auto.
 */
export async function generateWithFallback(
  req: TtsRequest,
  opts: { provider?: "auto" | "edge-tts" | "openai" } = {},
): Promise<TtsResult & { providerId: string }> {
  const mode = opts.provider ?? "auto";

  // Single-provider modes: run exactly that provider, no fallback.
  if (mode === "edge-tts" || mode === "openai") {
    const p = getProviderById(mode);
    if (!p) throw new Error(`TTS provider not found: ${mode}`);
    const result = await p.generate(req);
    return { ...result, providerId: p.id };
  }

  // auto: edge-tts first, openai as fallback.
  const order: TtsProvider[] = [edgeTtsProvider, openaiTtsProvider];
  const failures: string[] = [];
  for (const p of order) {
    if (!(await isProviderAvailable(p))) {
      failures.push(`${p.id}: unavailable`);
      continue;
    }
    try {
      const result = await p.generate(req);
      return { ...result, providerId: p.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${p.id}: ${message}`);
    }
  }
  throw new Error(`All TTS providers failed — ${failures.join("; ")}`);
}

export const ALL_TTS_PROVIDERS = ALL_PROVIDERS;
