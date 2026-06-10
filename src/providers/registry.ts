// ─────────────────────────────────────────────────────────────────────────────
// Single capability-tagged MediaProvider registry (ADR-007).
//
// CONTEXT invariant #2: OpenRouter is the only external gateway and EVERY media
// provider — image, video, tts — registers here. There is exactly ONE registry,
// ONE contract, ONE envKey convention. Adding a provider has a single entry
// point; "which registry do I touch?" has a permanent answer.
//
// Providers are tagged by a single `capability` discriminator ("image" |
// "video" | "tts"), not boolean flags — every provider serves exactly one
// capability. `envKey` is declarative (pneuma envMapping style): availability =
// process.env[provider.envKey] is set, except edge-tts (zero-cost local binary,
// always available). Exactly one provider per capability carries `default:true`.
//
// History: image lived here already; video had a parallel array registry under
// src/server/providers/ (runway/sora/kling stubs + seedance), and TTS had TWO
// modules (the src/tts-providers fallback registry + a standalone
// src/providers/tts/index.ts synth). ADR-007 consolidated all four: video is now
// honestly seedance-only (the stubs are gone — they produced nothing and implied
// direct vendor calls), and the two TTS paths merged into src/providers/tts/.
// ─────────────────────────────────────────────────────────────────────────────

import type { GenerateProvider, ImageOpts, GenerateResult } from "./base.js";
import { OpenRouterImageProvider } from "./openrouter-image.js";
import { createSeedanceProvider } from "./video/seedance.js";
import type {
  VideoProvider,
  VideoGenerateOptions,
  VideoGenerateResult,
} from "./video/types.js";
import { edgeTtsProvider } from "./tts/edge-tts.js";
import { geminiTtsProvider } from "./tts/gemini-tts.js";
import type { TtsProvider } from "./tts/types.js";
import { createLyriaProvider } from "./audio/lyria.js";
import type {
  MusicProvider,
  MusicGenerateOptions,
  MusicGenerateResult,
} from "./audio/types.js";

export type Capability = "image" | "video" | "tts" | "music";

interface MediaProviderBase {
  name: string;
  capability: Capability;
  /** Declarative env var whose presence makes the provider available. */
  envKey: string;
  /** Exactly one provider per capability is the default. */
  default?: boolean;
}

export interface ImageMediaProvider extends MediaProviderBase {
  capability: "image";
  /** Human-readable label. Optional so test fakes stay terse. */
  displayName?: string;
  generateImage(opts: ImageOpts): Promise<GenerateResult>;
}

export interface VideoMediaProvider extends MediaProviderBase {
  capability: "video";
  /** Human-readable label for the generation dialog (e.g. "Seedance 2.0"). */
  displayName: string;
  generateVideo(opts: VideoGenerateOptions): Promise<VideoGenerateResult>;
}

export interface TtsMediaProvider extends MediaProviderBase {
  capability: "tts";
  /** The underlying TtsProvider singleton. Synthesis routes through the
   *  fallback chain (generateWithFallback in ./tts/registry.js), not here —
   *  this entry exists so TTS participates in list/default/availability. */
  tts: TtsProvider;
}

export interface MusicMediaProvider extends MediaProviderBase {
  capability: "music";
  /** Human-readable label for the generation dialog (e.g. "Lyria 3 Pro"). */
  displayName: string;
  /**
   * The keyless singleton adapter. The HTTP route constructs its OWN
   * createLyriaProvider(config.openrouter.apiKey) so the key comes from the
   * user's config.yaml (not process.env) — this entry exists so music
   * participates in list/default/availability + provider validation.
   */
  generateMusic(opts: MusicGenerateOptions): Promise<MusicGenerateResult>;
}

export type MediaProvider =
  | ImageMediaProvider
  | VideoMediaProvider
  | TtsMediaProvider
  | MusicMediaProvider;

// Map keyed by `${capability}:${name}` so the same name could (in theory) exist
// under two capabilities without collision. Insertion order is preserved, so
// getDefaultProvider's "first registered" tiebreak is deterministic.
const providers = new Map<string, MediaProvider>();

// Historical inbound aliases. Renamed ids stay resolvable forever because old
// chat history, recipe docs and external scripts carry the old literal (e.g.
// `--provider nanobanana`); normalizing at this single lookup chokepoint means
// no HTTP route / CLI / config reader needs to know the history.
const PROVIDER_ID_ALIASES: Record<string, string> = {
  nanobanana: "openrouter-image",
};

function canonicalName(name: string): string {
  return PROVIDER_ID_ALIASES[name] ?? name;
}

function key(capability: Capability, name: string): string {
  return `${capability}:${canonicalName(name)}`;
}

export function registerProvider(p: MediaProvider): void {
  providers.set(key(p.capability, p.name), p);
}

/** Overloads so callers get the precise capability-specific type back. */
export function getProvider(
  capability: "image",
  name: string,
): ImageMediaProvider | undefined;
export function getProvider(
  capability: "video",
  name: string,
): VideoMediaProvider | undefined;
export function getProvider(
  capability: "tts",
  name: string,
): TtsMediaProvider | undefined;
export function getProvider(
  capability: "music",
  name: string,
): MusicMediaProvider | undefined;
export function getProvider(
  capability: Capability,
  name: string,
): MediaProvider | undefined;
export function getProvider(
  capability: Capability,
  name: string,
): MediaProvider | undefined {
  return providers.get(key(capability, name));
}

/** The default provider for a capability: the one flagged `default:true`, else
 *  the first registered for that capability. Deterministic, not order-fragile. */
export function getDefaultProvider(
  capability: "image",
): ImageMediaProvider | undefined;
export function getDefaultProvider(
  capability: "video",
): VideoMediaProvider | undefined;
export function getDefaultProvider(
  capability: "tts",
): TtsMediaProvider | undefined;
export function getDefaultProvider(
  capability: "music",
): MusicMediaProvider | undefined;
export function getDefaultProvider(
  capability: Capability,
): MediaProvider | undefined;
export function getDefaultProvider(
  capability: Capability,
): MediaProvider | undefined {
  let first: MediaProvider | undefined;
  for (const p of providers.values()) {
    if (p.capability !== capability) continue;
    if (p.default) return p;
    if (!first) first = p;
  }
  return first;
}

export interface ProviderListing {
  name: string;
  capability: Capability;
  envKey: string;
  default: boolean;
  /** True when the provider's envKey is present in the environment. edge-tts is
   *  a local binary and is always reported available. */
  available: boolean;
}

/** Lists providers, optionally filtered to one capability. */
export function listProviders(capability?: Capability): ProviderListing[] {
  const out: ProviderListing[] = [];
  for (const p of providers.values()) {
    if (capability && p.capability !== capability) continue;
    const available =
      p.name === edgeTtsProvider.id || Boolean(process.env[p.envKey]);
    out.push({
      name: p.name,
      capability: p.capability,
      envKey: p.envKey,
      default: Boolean(p.default),
      available,
    });
  }
  return out;
}

/** Test/teardown seam — clears the registry. */
export function _resetProviders(): void {
  providers.clear();
}

// ─── Capability adapters ─────────────────────────────────────────────────────
// Wrap each concrete provider so it satisfies the MediaProvider contract with a
// single `capability` tag + declarative envKey, instead of the old boolean
// flags / parallel ENV_KEY map.

function imageEntry(p: GenerateProvider): ImageMediaProvider {
  return {
    name: p.name,
    capability: "image",
    // displayName tracks the default model, not the gateway id — the id
    // ("openrouter-image") is stable while DEFAULT_MODEL may move.
    displayName: "GPT Image 2 (via OpenRouter)",
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateImage: (opts) => p.generateImage(opts),
  };
}

function videoEntry(p: VideoProvider): VideoMediaProvider {
  return {
    name: p.id,
    capability: "video",
    displayName: p.displayName,
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateVideo: (opts) => p.generateVideo(opts),
  };
}

function ttsEntry(
  p: TtsProvider,
  opts: { envKey: string; default?: boolean },
): TtsMediaProvider {
  return {
    name: p.id,
    capability: "tts",
    envKey: opts.envKey,
    default: opts.default,
    tts: p,
  };
}

function musicEntry(p: MusicProvider): MusicMediaProvider {
  return {
    name: p.id,
    capability: "music",
    displayName: p.displayName,
    // Declarative: doctor / availability gate on OPENROUTER_API_KEY. The HTTP
    // route injects the key from config.openrouter.apiKey at call time, so this
    // adapter (env-keyed singleton) is only the list/default/validation handle.
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateMusic: (opts) => p.generateMusic(opts),
  };
}

/**
 * Register the providers that need no runtime config: video (seedance) and TTS
 * (Gemini-via-OpenRouter default + edge-tts fallback — PRD-0003 §2 flipped the
 * chain from edge→openai-direct to Gemini→edge; openai-direct is retired). These
 * are stateless adapters — a key gates *availability*, not *registration* — so,
 * like the old module-level video array, they register at import time. This
 * makes the registry usable by any module that imports it (e.g. api.ts under
 * test) without a full server boot. Idempotent: re-registering the same key is a
 * harmless overwrite.
 */
function registerStaticProviders(): void {
  if (!getProvider("video", "seedance")) {
    registerProvider(videoEntry(createSeedanceProvider()));
  }
  if (!getProvider("tts", "gemini")) {
    registerProvider(
      ttsEntry(geminiTtsProvider, { envKey: "OPENROUTER_API_KEY", default: true }),
    );
  }
  if (!getProvider("tts", "edge-tts")) {
    registerProvider(ttsEntry(edgeTtsProvider, { envKey: "EDGE_TTS_PATH" }));
  }
  if (!getProvider("music", "lyria")) {
    // Keyless singleton — registration is key-independent; the key gates
    // availability + is injected per-call by the BGM route from config.yaml.
    registerProvider(musicEntry(createLyriaProvider(process.env.OPENROUTER_API_KEY ?? "")));
  }
}

// Populate the keyless capabilities on import — mirrors the pre-ADR-007 video
// registry that was a module-level array, so direct importers see them.
registerStaticProviders();

/**
 * Assemble every capability in one place. Video + TTS are registered statically
 * on import (see registerStaticProviders); this adds the keyed image provider
 * (OpenRouter gpt-5.4-image-2) once a key is present, and re-asserts the static
 * set so a fresh process / reset has them too.
 */
export async function initProviders(config: {
  openrouter?: { apiKey?: string };
}): Promise<void> {
  registerStaticProviders();

  // image — OpenRouter gpt-5.4-image-2, default for "image".
  if (config.openrouter?.apiKey && !getProvider("image", "openrouter-image")) {
    registerProvider(imageEntry(new OpenRouterImageProvider(config.openrouter.apiKey)));
  }
}
