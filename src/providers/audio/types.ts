// Audio (music / BGM) generation provider contract. Mirrors video/types.ts so
// the registry's capability-tagged adapter layer can wrap it the same way.
//
// The "music" capability is distinct from "tts": TTS narrates a script (text →
// speech), music generation composes an instrumental/vocal track from a prompt.
// Lyria 3 Pro (via OpenRouter) is the only music provider today.

export interface MusicGenerateOptions {
  /** Music description / instruction. */
  prompt: string;
  /**
   * Whether the track should contain vocals. Default false → the provider
   * prefixes the prompt with "Instrumental only, no vocals. " (Lyria's only
   * negative-constraint mechanism — there is no negative-prompt field).
   */
  vocal?: boolean;
  /** Optional seed for reproducible generation. */
  seed?: number;
  /** Optional sampling temperature (0.0–2.0). */
  temperature?: number;
  /**
   * Optional reference images (mood/cover). Each is either an http(s) URL or a
   * `data:image/...;base64,...` URI; sent as `image_url` content parts ahead of
   * the text part, exactly like the retired music_generate.py did.
   */
  referenceImages?: string[];
  /**
   * Absolute filesystem dir to write the generated mp3 into. Adapter creates it
   * if missing. The server endpoint computes this per-call so the file lands in
   * the work's asset tree. When omitted the adapter returns a relative assetUri
   * without writing (lets unit tests run without disk side effects).
   */
  outputAbsoluteDir?: string;
  /** Output filename (e.g. `bgm_1781088802.mp3`). */
  filename: string;
  /**
   * Per-call OpenRouter API key. When set it overrides any key the provider was
   * constructed with. The BGM route injects config.openrouter.apiKey here so the
   * keyless registry singleton can serve the request with the Settings-written
   * key (config.yaml, not process.env). Omit for stub/test paths.
   */
  apiKey?: string;
}

export interface MusicGenerateResult {
  /** Path the mp3 was written to (absolute when outputAbsoluteDir was given). */
  assetUri: string;
  /** Provider cost in USD (Lyria is a flat ~$0.08/track; 0 in stub mode). */
  costUsd?: number;
  /** True when no API key was available and a placeholder uri was returned. */
  stub?: boolean;
  /**
   * The raw joined audio bytes (present on the real path, not stub). Exposed so
   * the route can ffmpeg-truncate in place and tests can assert the SSE
   * collection without touching disk.
   */
  audioBytes?: Buffer;
}

export interface MusicProvider {
  id: string;
  displayName: string;
  generateMusic(opts: MusicGenerateOptions): Promise<MusicGenerateResult>;
}
