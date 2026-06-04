/**
 * Gemini-via-OpenRouter TTS provider — the PRIMARY leg of the dual-provider
 * registry (PRD-0003 §2, ADR-007 invariant #2).
 *
 * Speaks the OpenAI-compatible POST https://openrouter.ai/api/v1/audio/speech
 * endpoint with model "google/gemini-3.1-flash-tts-preview". The registry tries
 * this provider first; edge-tts (free local binary) is the zero-key fallback.
 *
 * This RETIRES the legacy openai-tts.ts direct path (api.openai.com), which
 * violated invariant #2 (OpenRouter is the only external gateway) and had a
 * key-fallback bug: with no OPENAI_API_KEY it fell back to OPENROUTER_API_KEY
 * but kept hitting api.openai.com, so the OpenRouter key was rejected. Routing
 * through OpenRouter makes OPENROUTER_API_KEY the one true key.
 *
 * Voice mapping (CRITICAL): callers pass an EDGE voice id (e.g.
 * "zh-CN-XiaoxiaoNeural") — or a gender hint — because the rest of the system
 * speaks edge voice ids. Gemini has its own prebuilt voice set, so
 * mapVoiceToGemini() maps the request voice to a gender-matched Gemini voice.
 * Gemini auto-detects language from the input text (70+ languages), so no
 * language flag is sent.
 *
 * Audio format (CRITICAL — verified live 2026-06-04): Gemini TTS on OpenRouter
 * ONLY supports response_format:"pcm" — requesting "mp3" returns HTTP 400
 * ("Gemini TTS only supports response_format=\"pcm\". Got \"mp3\"."), which made
 * this primary leg ALWAYS fail and silently fall back to edge-tts. So we request
 * "pcm" (raw signed 16-bit little-endian, 24000 Hz, mono) and transcode it to
 * mp3 via the managed ffmpeg binary, because the rest of the system + the .mp3
 * filename at req.outputPath expect an mp3 file.
 */
import { spawn } from "node:child_process";
import type { TtsProvider, TtsRequest, TtsResult } from "./types.js";
import { FFMPEG_BIN, FFPROBE_BIN } from "../../server/ffmpeg-paths.js";

/** OpenRouter's OpenAI-compatible speech endpoint (NOT api.openai.com). */
const OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";

/** The Gemini TTS model exposed on OpenRouter (PRD-0003 §2 verified 2026-06-04). */
const GEMINI_TTS_MODEL = "google/gemini-3.1-flash-tts-preview";

/**
 * Gemini's prebuilt voice names. Source: Google AI for Developers — Text-to-
 * speech generation (TTS) voice options
 * (https://ai.google.dev/gemini-api/docs/speech-generation). The full set is 30
 * voices; we surface a small gender-leaning subset that covers our edge→Gemini
 * mapping. Zephyr (bright/female-leaning), Kore (firm/female-leaning), Aoede
 * (breezy/female-leaning); Puck (upbeat/male-leaning), Charon (informative/
 * male-leaning), Fenrir (excitable/male-leaning).
 */
const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
] as const;
type GeminiVoice = (typeof GEMINI_VOICES)[number];

/** Default Gemini voice when no gender/voice signal is recognized. */
const DEFAULT_GEMINI_VOICE: GeminiVoice = "Kore";

/**
 * Maps a requested voice id to one of Gemini's prebuilt voices.
 *
 *   - Already a Gemini voice (Zephyr/Puck/Charon/Kore/Fenrir/Aoede) → as-is.
 *   - Known female edge voices (contain "Xiaoxiao" or "Aria") → "Kore".
 *   - Known male edge voices (contain "Yunjian" or "Guy") → "Charon".
 *   - Anything else → DEFAULT_GEMINI_VOICE.
 *
 * Mirrors the shape of edge-tts's catalog and the retired openai mapping: it
 * keys off the same edge-voice substrings ("Xiaoxiao"/"Aria"/"Yunjian"/"Guy")
 * so a caller that worked against the old fallback maps cleanly here too.
 */
export function mapVoiceToGemini(voice: string): GeminiVoice {
  if ((GEMINI_VOICES as readonly string[]).includes(voice)) {
    return voice as GeminiVoice;
  }
  if (voice.includes("Xiaoxiao") || voice.includes("Aria")) return "Kore";
  if (voice.includes("Yunjian") || voice.includes("Guy")) return "Charon";
  return DEFAULT_GEMINI_VOICE;
}

function resolveKey(env: NodeJS.ProcessEnv): string {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  throw new Error(
    "Gemini TTS (via OpenRouter) requires OPENROUTER_API_KEY in env",
  );
}

async function ffprobeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.slice(0, 200)}`));
      const v = parseFloat(out.trim());
      if (Number.isNaN(v)) return reject(new Error(`ffprobe non-numeric: ${out}`));
      resolve(v);
    });
  });
}

/**
 * Transcodes Gemini's raw PCM (signed 16-bit little-endian, 24000 Hz, mono) to
 * an mp3 at outPath, by piping the PCM buffer into ffmpeg's stdin. Mirrors
 * ffprobeDuration's spawn/Promise style. Resolves on exit code 0; rejects on a
 * non-zero exit (with a stderr tail) or a spawn error.
 */
async function transcodePcmToMp3(pcm: Buffer, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, [
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-codec:a",
      "libmp3lame",
      "-y",
      outPath,
    ]);
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg PCM→mp3 transcode failed: ${err.slice(0, 200)}`));
      }
      resolve();
    });
    child.stdin.write(pcm);
    child.stdin.end();
  });
}

/**
 * Testable core: POSTs to OpenRouter's /v1/audio/speech (response_format:"pcm",
 * the only format Gemini TTS supports), transcodes the raw PCM to an mp3 at
 * req.outputPath via ffmpeg, then ffprobes the duration. fetch + env are
 * injectable so tests never hit the network; the ffmpeg/ffprobe spawns are
 * mockable via node:child_process.
 */
export async function synthesizeGeminiTts(
  req: TtsRequest,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<TtsResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const key = resolveKey(env);

  const res = await fetchImpl(OPENROUTER_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      voice: mapVoiceToGemini(req.voice),
      input: req.text,
      // Gemini TTS on OpenRouter ONLY accepts "pcm" — "mp3" 400s. We transcode
      // the returned raw PCM to mp3 below.
      response_format: "pcm",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `Gemini TTS request failed: ${res.status} ${res.statusText} — ${detail.slice(0, 240)}`,
    );
  }

  // OpenRouter sometimes returns a 200 whose body is a JSON/HTML error envelope
  // rather than audio bytes. Reject before transcoding so generateWithFallback's
  // auto mode falls through to edge-tts instead of producing a broken-but-200
  // asset. The PCM response arrives with a non-`audio/`-prefixed content-type
  // (e.g. application/octet-stream, audio/L16, audio/pcm) or none at all, so we
  // can't gate on "starts with audio/". Instead reject ONLY when the header
  // clearly indicates a TEXT/JSON error envelope.
  const contentType = res.headers.get("content-type") ?? "";
  const ctLower = contentType.toLowerCase();
  if (ctLower.startsWith("text/") || ctLower.includes("json")) {
    const detail = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `Gemini TTS returned non-audio response (content-type: ${contentType}) — ${detail.slice(0, 240)}`,
    );
  }

  const pcm = Buffer.from(await res.arrayBuffer());
  // Defensive: a 200 with an empty / truncated body would produce a 0-byte file
  // that shows in the library but won't play. Throw so the registry falls back
  // to edge-tts. Mirrors edge-tts.ts's empty-file guard.
  if (pcm.byteLength === 0) {
    throw new Error("Gemini TTS returned empty audio");
  }
  // Gemini returns raw PCM (s16le / 24000 Hz / mono); transcode it to the mp3
  // the rest of the system + the .mp3 filename at req.outputPath expect.
  await transcodePcmToMp3(pcm, req.outputPath);

  // ffprobe is best-effort: the bytes are already on disk, so a missing
  // ffprobe shouldn't fail synthesis. Fall back to duration 0.
  let duration = 0;
  try {
    duration = await ffprobeDuration(req.outputPath);
  } catch {
    duration = 0;
  }

  return {
    outputPath: req.outputPath,
    duration,
    sampleRate: 24000,
    channels: 1,
  };
}

export const geminiTtsProvider: TtsProvider = {
  id: "gemini",
  name: "Gemini TTS via OpenRouter (google/gemini-3.1-flash-tts-preview)",
  supportsLanguages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "es-ES", "fr-FR"],
  voices: GEMINI_VOICES.map((id) => ({
    id,
    name: `Gemini ${id}`,
    lang: "multi",
    tags: ["multi"],
  })),
  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },
  async generate(req: TtsRequest): Promise<TtsResult> {
    return synthesizeGeminiTts(req);
  },
};
