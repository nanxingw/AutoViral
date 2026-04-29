import { edgeTtsProvider } from "./edge-tts.js";
import type { TtsProvider } from "./types.js";

export interface ProviderPickOptions {
  language?: string;
  preferQuality?: boolean;
}

const ALL_PROVIDERS: TtsProvider[] = [
  edgeTtsProvider,
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

export const ALL_TTS_PROVIDERS = ALL_PROVIDERS;
