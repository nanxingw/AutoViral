import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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

// ─── Narration helper ───────────────────────────────────────────────────────
// Bridge-friendly entry point. The bridge preprocess route (and any caller that
// only has a workDir) wants "synthesize this text into the work's assets/audio/
// dir and tell me the relative uri + byte size" — it does not want to compute
// an output path or pick a provider. This wraps generateWithFallback (edge-tts
// first → openai fallback) with that ergonomics, preserving the H4.1 idempotent
// hash-stem so re-synthesising identical input is a no-op-ish overwrite.
//
// Replaces the standalone src/providers/tts/index.ts synthesize() retired by
// ADR-007 — the OpenAI-only synth is now the openai provider behind the
// fallback chain, so this gains edge-tts as the zero-cost primary for free.

/** Default edge voice when the caller does not specify one. */
const DEFAULT_NARRATION_VOICE = "zh-CN-XiaoxiaoNeural";

export interface SynthesizeNarrationOpts {
  text: string;
  /** Edge voice id (e.g. "zh-CN-XiaoxiaoNeural"); openai fallback maps it. */
  voice?: string;
  language?: string;
  /** Output container; defaults to mp3. Only the extension is honoured. */
  format?: string;
  /** Absolute path of the work's directory; audio lands under assets/audio/. */
  workDir: string;
  /** Optional override for the output filename stem (defaults to a hash). */
  filenameStem?: string;
  /** Force a single provider; defaults to "auto" (edge → openai). */
  provider?: "auto" | "edge-tts" | "openai";
}

export interface SynthesizeNarrationResult {
  /** Absolute path of the resulting audio file. */
  assetPath: string;
  /** Relative-to-workDir path, suitable for composition.yaml assets[].uri. */
  relativeUri: string;
  /** Provider that actually produced the audio ("edge-tts" | "openai"). */
  providerId: string;
  /** Probed duration in seconds (0 if ffprobe unavailable). */
  duration: number;
  /** Byte size of the audio file. */
  bytes: number;
}

export async function synthesizeNarration(
  opts: SynthesizeNarrationOpts,
): Promise<SynthesizeNarrationResult> {
  const text = opts.text;
  if (!text || text.trim().length === 0) {
    throw new Error("TTS text must be non-empty");
  }
  const voice = opts.voice || DEFAULT_NARRATION_VOICE;
  const format = opts.format ?? "mp3";

  const stem =
    opts.filenameStem ??
    createHash("sha1").update(`${voice}|${format}|${text}`).digest("hex").slice(0, 12);
  const filename = `${stem}.${format}`;
  const audioDir = join(opts.workDir, "assets", "audio");
  await mkdir(audioDir, { recursive: true });
  const outputPath = join(audioDir, filename);

  const result = await generateWithFallback(
    { text, voice, language: opts.language, outputPath },
    { provider: opts.provider ?? "auto" },
  );

  const s = await stat(outputPath);
  return {
    assetPath: outputPath,
    relativeUri: `assets/audio/${filename}`,
    providerId: result.providerId,
    duration: result.duration,
    bytes: s.size,
  };
}
