/**
 * OpenAI TTS provider — the fallback leg of the dual-provider registry.
 *
 * Speaks the OpenAI /v1/audio/speech protocol (same wire format as
 * src/providers/tts). The registry tries edge-tts first; this provider runs
 * when edge-tts is unavailable or throws.
 *
 * Voice mapping (CRITICAL): callers pass an EDGE voice id (e.g.
 * "zh-CN-XiaoxiaoNeural"). OpenAI does NOT understand edge voice ids, so
 * mapVoiceToOpenAi() infers a gender-matched OpenAI voice. OpenAI auto-detects
 * the language from the input text, so no language flag is sent.
 *
 * Key resolution: OPENAI_API_KEY preferred, else OPENROUTER_API_KEY, else throw.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { TtsProvider, TtsRequest, TtsResult } from "./types.js";
import { FFPROBE_BIN } from "../../server/ffmpeg-paths.js";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

/** The six OpenAI speech voices. */
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
type OpenAiVoice = (typeof OPENAI_VOICES)[number];

/**
 * Maps a requested voice id to one of OpenAI's six voices.
 *
 *   - Already an OpenAI voice (alloy/echo/fable/onyx/nova/shimmer) → as-is.
 *   - Known female edge voices (contain "Xiaoxiao" or "Aria") → "nova".
 *   - Known male edge voices (contain "Yunjian" or "Guy") → "onyx".
 *   - Anything else → "nova" (neutral default).
 */
export function mapVoiceToOpenAi(voice: string): OpenAiVoice {
  if ((OPENAI_VOICES as readonly string[]).includes(voice)) {
    return voice as OpenAiVoice;
  }
  if (voice.includes("Xiaoxiao") || voice.includes("Aria")) return "nova";
  if (voice.includes("Yunjian") || voice.includes("Guy")) return "onyx";
  return "nova";
}

function resolveKey(env: NodeJS.ProcessEnv): string {
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  throw new Error(
    "OpenAI TTS requires OPENAI_API_KEY (preferred) or OPENROUTER_API_KEY in env",
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
 * Testable core: POSTs to OpenAI, writes the mp3 to req.outputPath, ffprobes
 * the duration. fetch + env are injectable so tests never hit the network.
 */
export async function synthesizeOpenAiTts(
  req: TtsRequest,
  deps: { fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<TtsResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const key = resolveKey(env);

  const res = await fetchImpl(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: mapVoiceToOpenAi(req.voice),
      input: req.text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `OpenAI TTS request failed: ${res.status} ${res.statusText} — ${detail.slice(0, 240)}`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(req.outputPath, buf);

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

export const openaiTtsProvider: TtsProvider = {
  id: "openai",
  name: "OpenAI Speech (/v1/audio/speech, multilingual)",
  supportsLanguages: ["zh-CN", "en-US", "ja-JP", "es-ES", "fr-FR"],
  voices: OPENAI_VOICES.map((id) => ({
    id,
    name: `OpenAI ${id}`,
    lang: "multi",
    tags: ["multi"],
  })),
  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
  },
  async generate(req: TtsRequest): Promise<TtsResult> {
    return synthesizeOpenAiTts(req);
  },
};
