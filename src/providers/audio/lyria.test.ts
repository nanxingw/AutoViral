import { describe, it, expect, vi, afterEach } from "vitest";
import { createLyriaProvider } from "./lyria.js";

// Helper: build a fetch Response whose body is a ReadableStream that emits the
// given SSE chunks (already including the trailing "\n\n" framing). Lyria
// streams audio as base64 inside `data: {...}` lines, terminated by
// `data: [DONE]`, interspersed with `: OPENROUTER PROCESSING` heartbeats that do
// NOT start with "data: " and must be skipped.
function sseResponse(
  lines: string[],
  init: { contentType?: string } = {},
): Response {
  const body = lines.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": init.contentType ?? "text/event-stream" },
  });
}

/** base64 of a tiny valid-ish "mp3" payload (ID3 header + a few bytes). */
function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}
// "ID3" magic so a magic-byte check would pass; content is otherwise arbitrary.
const ID3_CHUNK_A = [0x49, 0x44, 0x33, 0x03, 0x00, 0x01, 0x02];
const ID3_CHUNK_B = [0x03, 0x04, 0x05];

describe("createLyriaProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a stub asset (no network) when apiKey is empty", async () => {
    const fetchMock = vi.fn();
    const provider = createLyriaProvider("", { fetch: fetchMock });
    const result = await provider.generateMusic({
      prompt: "calm lofi piano",
      filename: "bgm.mp3",
    });
    expect(result.stub).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.assetUri).toContain("lyria-");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the documented Lyria contract: chat/completions, modalities, stream, instrumental prefix, HTTP-Referer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"audio":{"data":"${b64(ID3_CHUNK_A)}"}}}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await provider.generateMusic({ prompt: "calm lofi piano", filename: "bgm.mp3" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    expect(opts.headers["HTTP-Referer"]).toBe("http://localhost:3271");
    const sent = JSON.parse(opts.body as string);
    expect(sent.model).toBe("google/lyria-3-pro-preview");
    expect(sent.modalities).toEqual(["text", "audio"]);
    expect(sent.stream).toBe(true);
    // Instrumental default: prompt is prefixed when vocal is not set.
    const textPart = sent.messages[0].content.find((p: any) => p.type === "text");
    expect(textPart.text).toBe("Instrumental only, no vocals. calm lofi piano");
    // No duration field — Lyria does not accept one.
    expect("duration" in sent).toBe(false);
  });

  it("does NOT prefix the prompt when vocal:true, and forwards seed/temperature/refImages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"audio":{"data":"${b64(ID3_CHUNK_A)}"}}}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await provider.generateMusic({
      prompt: "a gentle folk song",
      filename: "song.mp3",
      vocal: true,
      seed: 42,
      temperature: 1.2,
      referenceImages: ["https://cdn.example.com/cover.png"],
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.seed).toBe(42);
    expect(sent.temperature).toBe(1.2);
    const content = sent.messages[0].content;
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "https://cdn.example.com/cover.png" },
    });
    const textPart = content.find((p: any) => p.type === "text");
    expect(textPart.text).toBe("a gentle folk song"); // no instrumental prefix
  });

  it("collects + joins delta.audio.data chunks across the stream, skipping heartbeats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `: OPENROUTER PROCESSING\n\n`,
        `data: {"choices":[{"delta":{"content":"[[A0]]"}}]}\n\n`,
        `: OPENROUTER PROCESSING\n\n`,
        `data: {"choices":[{"delta":{"audio":{"data":"${b64(ID3_CHUNK_A)}"}}}]}\n\n`,
        `data: {"choices":[{"delta":{"audio":{"data":"${b64(ID3_CHUNK_B)}"}}}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    const result = await provider.generateMusic({
      prompt: "x",
      filename: "bgm.mp3",
    });
    expect(result.stub).toBe(false);
    expect(result.audioBytes).toEqual(Buffer.from([...ID3_CHUNK_A, ...ID3_CHUNK_B]));
  });

  it("falls back to delta.images[].image_url.url data:audio base64 when no delta.audio", async () => {
    const dataUri = `data:audio/mp3;base64,${b64(ID3_CHUNK_A)}`;
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"images":[{"image_url":{"url":"${dataUri}"}}]}}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    const result = await provider.generateMusic({ prompt: "x", filename: "bgm.mp3" });
    expect(result.audioBytes).toEqual(Buffer.from(ID3_CHUNK_A));
  });

  it("throws on a non-OK HTTP status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await expect(
      provider.generateMusic({ prompt: "x", filename: "bgm.mp3" }),
    ).rejects.toThrow(/Lyria request failed: 429/);
  });

  it("throws when the SSE stream carries an error envelope chunk", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"error":{"message":"model overloaded"}}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await expect(
      provider.generateMusic({ prompt: "x", filename: "bgm.mp3" }),
    ).rejects.toThrow(/model overloaded/);
  });

  it("throws when the 200 body is a JSON error envelope (no audio bytes)", async () => {
    // OpenRouter occasionally 200s with JSON instead of an event-stream.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await expect(
      provider.generateMusic({ prompt: "x", filename: "bgm.mp3" }),
    ).rejects.toThrow(/non-audio response/i);
  });

  it("throws when the stream completes with zero audio bytes (no silent 0-byte file)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: {"choices":[{"delta":{"content":"[[A0]]"}}]}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    );
    const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
    await expect(
      provider.generateMusic({ prompt: "x", filename: "bgm.mp3" }),
    ).rejects.toThrow(/empty audio|no audio/i);
  });

  it("writes the joined bytes to outputAbsoluteDir/filename when given a dir", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "lyria-test-"));
    try {
      const fetchMock = vi.fn().mockResolvedValue(
        sseResponse([
          `data: {"choices":[{"delta":{"audio":{"data":"${b64(ID3_CHUNK_A)}"}}}]}\n\n`,
          `data: [DONE]\n\n`,
        ]),
      );
      const provider = createLyriaProvider("sk-test", { fetch: fetchMock });
      const result = await provider.generateMusic({
        prompt: "x",
        filename: "bgm.mp3",
        outputAbsoluteDir: dir,
      });
      expect(result.assetUri).toBe(join(dir, "bgm.mp3"));
      const written = await readFile(join(dir, "bgm.mp3"));
      expect(written).toEqual(Buffer.from(ID3_CHUNK_A));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
