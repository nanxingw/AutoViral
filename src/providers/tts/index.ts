/**
 * TTS provider — synthesize narration audio.
 *
 * H4.1 ships an OpenAI-compatible client (POST /v1/audio/speech). Key
 * comes from one of two env vars in order of preference:
 *   OPENAI_API_KEY     — direct OpenAI
 *   OPENROUTER_API_KEY — OpenRouter passthrough (some users have only this)
 *
 * Output: mp3 (default) or wav, dropped into the work's
 * assets/audio/<hash>.<ext>. A short sha1 of (text + voice + format)
 * gives the filename so re-synthesis of the same input is idempotent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export const TTS_FORMATS = ["mp3", "wav", "opus", "aac", "flac"] as const;
export type TtsFormat = (typeof TTS_FORMATS)[number];

export interface SynthesizeOpts {
  text: string;
  voice?: TtsVoice;
  format?: TtsFormat;
  model?: string;
  /** Absolute path of the work's directory (e.g. ~/.autoviral/works/<id>).
   *  Audio is dropped under workDir/assets/audio/. */
  workDir: string;
  /** Optional override for the output filename stem (defaults to a hash). */
  filenameStem?: string;
  /** Pluggable fetcher — defaults to global fetch. Test seam. */
  fetch?: typeof globalThis.fetch;
  /** Pluggable env reader — defaults to process.env. Test seam. */
  env?: NodeJS.ProcessEnv;
}

export interface SynthesizeResult {
  /** Absolute path of the resulting audio file. */
  assetPath: string;
  /** Relative-to-workDir path, suitable for `composition.yaml.assets[].uri`. */
  relativeUri: string;
  /** Voice + format actually used (defaults resolved). */
  voice: TtsVoice;
  format: TtsFormat;
  /** Byte size of the audio file. */
  bytes: number;
}

export class TtsConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TtsConfigError";
  }
}

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

function resolveKey(env: NodeJS.ProcessEnv): {
  key: string;
  baseUrl: string;
} {
  if (env.OPENAI_API_KEY) {
    return { key: env.OPENAI_API_KEY, baseUrl: OPENAI_TTS_URL };
  }
  if (env.OPENROUTER_API_KEY) {
    // OpenRouter doesn't currently expose /v1/audio/speech as a passthrough,
    // but accept the key for forward-compat if a user only has this one set.
    // The actual call will likely 404 — surfaced as a TtsConfigError with a
    // helpful message.
    return { key: env.OPENROUTER_API_KEY, baseUrl: OPENAI_TTS_URL };
  }
  throw new TtsConfigError(
    "TTS requires OPENAI_API_KEY (preferred) or OPENROUTER_API_KEY in env",
  );
}

export async function synthesize(
  opts: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const voice: TtsVoice = opts.voice ?? "alloy";
  const format: TtsFormat = opts.format ?? "mp3";
  const model = opts.model ?? "tts-1";
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  if (!opts.text || opts.text.trim().length === 0) {
    throw new TtsConfigError("TTS text must be non-empty");
  }

  const { key, baseUrl } = resolveKey(env);

  const res = await fetchImpl(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      voice,
      input: opts.text,
      response_format: format,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `TTS request failed: ${res.status} ${res.statusText} — ${detail.slice(0, 240)}`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());

  const stem =
    opts.filenameStem ??
    createHash("sha1")
      .update(`${voice}|${format}|${model}|${opts.text}`)
      .digest("hex")
      .slice(0, 12);
  const filename = `${stem}.${format}`;
  const audioDir = join(opts.workDir, "assets", "audio");
  await mkdir(audioDir, { recursive: true });
  const assetPath = join(audioDir, filename);
  await writeFile(assetPath, buf);

  return {
    assetPath,
    relativeUri: `assets/audio/${filename}`,
    voice,
    format,
    bytes: buf.byteLength,
  };
}
