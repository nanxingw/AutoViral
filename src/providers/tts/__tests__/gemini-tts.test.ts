import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock node:child_process so neither the ffmpeg PCM→mp3 transcode nor the
// ffprobe duration probe shells out to a real binary. The transcode spawn
// (target FFMPEG_BIN, args include "pipe:0" + "libmp3lame") gets a stdin sink
// and closes with code 0; the ffprobe spawn (target FFPROBE_BIN) emits a
// numeric duration on stdout then closes 0. Mirrors render-pipeline.test.ts /
// edge-tts spawn-mock pattern (EventEmitter + stdout/stderr/stdin, emit
// 'close').
vi.mock("node:child_process", () => {
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    const isTranscode = args.includes("pipe:0");
    // stdin is only exercised by the transcode leg; give it a no-op sink.
    proc.stdin = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
    });
    // Drive the child to a clean exit asynchronously (after listeners attach).
    setImmediate(() => {
      if (!isTranscode) {
        // ffprobe: emit a numeric duration then close 0.
        proc.stdout.emit("data", Buffer.from("3.21\n"));
      }
      proc.emit("close", 0);
    });
    return proc;
  });
  return { spawn };
});

import { spawn } from "node:child_process";
import {
  synthesizeGeminiTts,
  mapVoiceToGemini,
  geminiTtsProvider,
} from "../gemini-tts.js";

const _spawn = spawn as unknown as ReturnType<typeof vi.fn>;

// Typed fetch stub so mock.calls tuples carry RequestInit (vi.fn() with no
// param types yields empty tuples — see tts.test.ts gotcha).
function fetchReturning(
  res: Response,
): { fn: typeof globalThis.fetch; calls: Array<Parameters<typeof globalThis.fetch>> } {
  const calls: Array<Parameters<typeof globalThis.fetch>> = [];
  const fn = (async (...args: Parameters<typeof globalThis.fetch>) => {
    calls.push(args);
    return res;
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

describe("mapVoiceToGemini (edge → Gemini voice mapping)", () => {
  it("maps female edge voices (Xiaoxiao / Aria) to Kore", () => {
    expect(mapVoiceToGemini("zh-CN-XiaoxiaoNeural")).toBe("Kore");
    expect(mapVoiceToGemini("en-US-AriaNeural")).toBe("Kore");
  });

  it("maps male edge voices (Yunjian / Guy) to Charon", () => {
    expect(mapVoiceToGemini("en-US-GuyNeural")).toBe("Charon");
    expect(mapVoiceToGemini("zh-CN-YunjianNeural")).toBe("Charon");
  });

  it("passes through an already-valid Gemini voice unchanged", () => {
    expect(mapVoiceToGemini("Zephyr")).toBe("Zephyr");
    expect(mapVoiceToGemini("Puck")).toBe("Puck");
    expect(mapVoiceToGemini("Aoede")).toBe("Aoede");
  });

  it("defaults unknown voices to Kore", () => {
    expect(mapVoiceToGemini("totally-unknown-voice")).toBe("Kore");
  });
});

describe("synthesizeGeminiTts (testable core)", () => {
  let workDir: string;

  beforeEach(async () => {
    _spawn.mockClear();
    workDir = await mkdtemp(join(tmpdir(), "gemini-tts-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("happy path: transcodes the returned PCM to mp3 at outputPath", async () => {
    const fakePcm = Buffer.from("\x00\x01\x02\x03raw-pcm-bytes");
    const { fn } = fetchReturning(
      new Response(fakePcm, { status: 200, statusText: "OK" }),
    );
    const out = join(workDir, "out.mp3");
    const res = await synthesizeGeminiTts(
      { text: "你好，世界", voice: "zh-CN-XiaoxiaoNeural", outputPath: out },
      { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
    );
    expect(res.outputPath).toBe(out);
    expect(res.sampleRate).toBe(24000);
    expect(res.channels).toBe(1);
    expect(res.duration).toBe(3.21); // from the mocked ffprobe

    // The transcode spawn must invoke ffmpeg reading raw s16le PCM from stdin
    // and writing mp3 (libmp3lame) to outputPath, and the PCM bytes must be
    // written to its stdin.
    const transcode = _spawn.mock.calls.find((c: any[]) =>
      (c[1] as string[]).includes("pipe:0"),
    );
    expect(transcode, "expected an ffmpeg transcode spawn").toBeDefined();
    const args = transcode![1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
        "-codec:a", "libmp3lame", "-y", out,
      ]),
    );
    const proc = _spawn.mock.results.find(
      (r: any) => r.value.stdin?.write,
    )!.value as any;
    expect(proc.stdin.write).toHaveBeenCalled();
    const written = proc.stdin.write.mock.calls[0][0] as Buffer;
    expect(Buffer.from(written).equals(fakePcm)).toBe(true);
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("POSTs to OpenRouter's /v1/audio/speech — NOT api.openai.com", async () => {
    const { fn, calls } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await synthesizeGeminiTts(
      { text: "hello", voice: "en-US-GuyNeural", outputPath: join(workDir, "o.mp3") },
      { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
    );
    const url = calls[0]?.[0];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(String(url)).not.toContain("api.openai.com");
  });

  it("sends the Gemini model + mapped voice + response_format pcm in the body", async () => {
    const { fn, calls } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await synthesizeGeminiTts(
      { text: "hello", voice: "en-US-GuyNeural", outputPath: join(workDir, "o.mp3") },
      { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
    );
    const init = calls[0]?.[1];
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent.model).toBe("google/gemini-3.1-flash-tts-preview");
    expect(sent.voice).toBe("Charon"); // Guy → Charon
    expect(sent.response_format).toBe("pcm");
    expect(sent.input).toBe("hello");
  });

  it("authenticates with Bearer OPENROUTER_API_KEY", async () => {
    const { fn, calls } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await synthesizeGeminiTts(
      { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
      { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-xyz" } },
    );
    const headers = calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-xyz");
  });

  it("throws when OPENROUTER_API_KEY is absent (no api.openai.com fallback)", async () => {
    const { fn } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await expect(
      synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: {} },
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("surfaces a non-2xx response as an error", async () => {
    const { fn } = fetchReturning(
      new Response("auth failed", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(
      synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-bad" } },
      ),
    ).rejects.toThrow(/Gemini TTS request failed: 401/);
  });

  it("throws on a 200 with an empty body (so the registry falls back to edge)", async () => {
    const { fn } = fetchReturning(
      new Response(Buffer.from(""), { status: 200, statusText: "OK" }),
    );
    await expect(
      synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
      ),
    ).rejects.toThrow(/empty audio/);
  });

  it("throws on a 200 whose content-type is a TEXT error envelope (text/html)", async () => {
    const { fn } = fetchReturning(
      new Response("<html>error</html>", {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
      ),
    ).rejects.toThrow(/non-audio response/);
  });

  it("throws on a 200 whose content-type is a JSON error envelope (application/json)", async () => {
    const { fn } = fetchReturning(
      new Response('{"error":{"message":"boom"}}', {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
      ),
    ).rejects.toThrow(/non-audio response/);
  });

  it("ACCEPTS a pcm/octet-stream content-type (does not reject on the guard)", async () => {
    // Gemini's raw PCM arrives as application/octet-stream (or audio/L16, or no
    // header) — those are valid and must reach the transcode, not get rejected.
    for (const ct of ["application/octet-stream", "audio/L16", "audio/pcm"]) {
      const { fn } = fetchReturning(
        new Response(Buffer.from("raw-pcm"), {
          status: 200,
          statusText: "OK",
          headers: { "content-type": ct },
        }),
      );
      const res = await synthesizeGeminiTts(
        { text: "x", voice: "Kore", outputPath: join(workDir, `o-${ct.replace(/\W/g, "")}.mp3`) },
        { fetch: fn, env: { OPENROUTER_API_KEY: "sk-or-test" } },
      );
      expect(res.sampleRate).toBe(24000);
      // The transcode spawn ran (guard let it through).
      expect(
        _spawn.mock.calls.some((c: any[]) => (c[1] as string[]).includes("pipe:0")),
      ).toBe(true);
    }
  });
});

describe("geminiTtsProvider.isAvailable", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("is true when OPENROUTER_API_KEY is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(await geminiTtsProvider.isAvailable!()).toBe(true);
  });

  it("is false when OPENROUTER_API_KEY is absent", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await geminiTtsProvider.isAvailable!()).toBe(false);
  });
});
