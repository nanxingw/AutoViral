import type { MusicProvider, MusicGenerateOptions, MusicGenerateResult } from "./types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * Lyria 3 Pro music/BGM provider via OpenRouter.
 *
 * Ports the (deleted) music_generate.py logic to TS. Unlike Seedance's async
 * videos job, Lyria streams synchronously over the OpenAI-compatible
 * chat/completions endpoint:
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   body { model: "google/lyria-3-pro-preview", modalities: ["text","audio"],
 *          messages: [{ role: "user", content: [...refImages, {type:"text",text}] }],
 *          stream: true, ...(seed) ...(temperature) }
 *
 * The SSE response is line-framed: `data: {json}` chunks terminated by
 * `data: [DONE]`, interspersed with `: OPENROUTER PROCESSING` heartbeat lines
 * (which do NOT start with "data: " and are skipped). Audio arrives base64-
 * encoded in `delta.audio.data` (primary, verified live 2026-06-10 — a single
 * ~1.8 MB ID3/MP3 chunk for a ~74s clip); a `delta.images[].image_url.url`
 * `data:audio/...;base64,...` fallback covers other audio models. Chunks are
 * b64-decoded and joined into the final mp3 bytes.
 *
 * There is NO duration parameter — Lyria emits a full ~1–2 minute track at a
 * flat ~$0.08/track. The server endpoint optionally truncates with ffmpeg.
 *
 * Defenses (mirror gemini-tts.ts): a non-OK status throws; a 200 whose
 * content-type is text/JSON is an error envelope (no audio) and throws; an
 * in-stream `error` chunk throws; zero collected audio bytes throws rather than
 * writing a silent 0-byte file.
 *
 * Falls back to a stub (no network) when no apiKey is provided, so a keyless
 * install never crashes — mirrors createSeedanceProvider.
 */

export const LYRIA_URL = "https://openrouter.ai/api/v1/chat/completions";
export const LYRIA_MODEL = "google/lyria-3-pro-preview";

/** Audio data-URI pattern (shared with the images[] fallback). */
const AUDIO_DATA_URI = /^data:audio\/[^;]+;base64,(.+)$/s;

export interface LyriaProviderDeps {
  /** Injectable fetch so tests never hit the network. */
  fetch?: typeof globalThis.fetch;
  /** Override OpenRouter URL (for testing). */
  baseUrl?: string;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/** Reads an SSE ReadableStream and collects Lyria's audio bytes. */
async function collectAudioFromStream(
  body: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  let buffered = "";

  const handleLine = (line: string): void => {
    if (!line.startsWith("data: ")) return; // skip ": OPENROUTER PROCESSING" heartbeats / blanks
    const dataStr = line.slice(6).trim();
    if (dataStr === "[DONE]") return;
    let parsed: any;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return; // partial / non-JSON line — ignore
    }
    if (parsed?.error) {
      const msg =
        parsed.error?.message ?? JSON.stringify(parsed.error);
      throw new Error(`Lyria stream error: ${msg}`);
    }
    const delta = parsed?.choices?.[0]?.delta ?? {};
    // Primary: delta.audio.data (base64).
    if (delta.audio && typeof delta.audio.data === "string") {
      chunks.push(Buffer.from(delta.audio.data, "base64"));
    }
    // Fallback: delta.images[].image_url.url holding a data:audio b64 URI.
    if (Array.isArray(delta.images)) {
      for (const img of delta.images) {
        const url: string =
          img?.image_url?.url ?? img?.url ?? "";
        const m = AUDIO_DATA_URI.exec(url);
        if (m) chunks.push(Buffer.from(m[1], "base64"));
      }
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, nl).replace(/\r$/, "");
      buffered = buffered.slice(nl + 1);
      handleLine(line);
    }
  }
  // Flush any trailing line not terminated by a newline.
  if (buffered.trim().length > 0) handleLine(buffered.replace(/\r$/, ""));

  return Buffer.concat(chunks);
}

export function createLyriaProvider(
  constructorKey: string,
  deps: LyriaProviderDeps = {},
): MusicProvider {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? LYRIA_URL;
  return {
    id: "lyria",
    displayName: "Lyria 3 Pro (via OpenRouter)",
    async generateMusic(req: MusicGenerateOptions): Promise<MusicGenerateResult> {
      // Per-call key wins (the BGM route injects config.openrouter.apiKey),
      // falling back to the construct-time key (env singleton / direct use).
      const apiKey = req.apiKey || constructorKey;
      if (!apiKey) {
        // Stub mode: no API key — return a placeholder uri, never call the net.
        const hash = hashPrompt(req.prompt);
        return {
          assetUri: req.outputAbsoluteDir
            ? join(req.outputAbsoluteDir, req.filename)
            : `assets/stub-audio/lyria-${hash}.mp3`,
          stub: true,
          costUsd: 0,
        };
      }

      // Build content parts: reference images first, then the text prompt.
      const content: Array<Record<string, unknown>> = [];
      for (const ref of req.referenceImages ?? []) {
        content.push({ type: "image_url", image_url: { url: ref } });
      }
      const vocal = req.vocal === true;
      const finalPrompt = vocal
        ? req.prompt
        : `Instrumental only, no vocals. ${req.prompt}`;
      content.push({ type: "text", text: finalPrompt });

      const payload: Record<string, unknown> = {
        model: LYRIA_MODEL,
        modalities: ["text", "audio"],
        messages: [{ role: "user", content }],
        stream: true,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      };

      const res = await fetchImpl(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3271",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "<unreadable>");
        throw new Error(
          `Lyria request failed: ${res.status} ${res.statusText} — ${detail.slice(0, 240)}`,
        );
      }

      // OpenRouter sometimes 200s with a JSON/HTML error envelope instead of an
      // SSE audio stream. The real stream is `text/event-stream`; a text/json
      // content-type means an error body, so reject before parsing (mirrors
      // gemini-tts.ts:189-203).
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("json") || contentType.startsWith("text/html")) {
        const detail = await res.text().catch(() => "<unreadable>");
        throw new Error(
          `Lyria returned non-audio response (content-type: ${contentType}) — ${detail.slice(0, 240)}`,
        );
      }

      if (!res.body) {
        throw new Error("Lyria returned no response body");
      }

      const audioBytes = await collectAudioFromStream(res.body);
      // Defensive: a 200 with no audio bytes would otherwise write a 0-byte file
      // that shows in the library but won't play. Throw instead.
      if (audioBytes.byteLength === 0) {
        throw new Error("Lyria returned empty audio (no audio bytes in stream)");
      }

      const targetDir = req.outputAbsoluteDir;
      let assetUri: string;
      if (targetDir) {
        await mkdir(targetDir, { recursive: true });
        assetUri = join(targetDir, req.filename);
        await writeFile(assetUri, audioBytes);
      } else {
        assetUri = `assets/lyria/${req.filename}`;
      }

      return {
        assetUri,
        // Lyria is a flat-rate model; OpenRouter does not return per-call cost in
        // the stream chunks, so we record the documented flat price.
        costUsd: 0.08,
        stub: false,
        audioBytes,
      };
    },
  };
}

export const lyriaProvider = createLyriaProvider(process.env.OPENROUTER_API_KEY ?? "");
