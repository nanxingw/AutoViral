import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  synthesizeOpenAiTts,
  mapVoiceToOpenAi,
  openaiTtsProvider,
} from "../openai-tts.js";

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

describe("mapVoiceToOpenAi (edge → openai voice mapping)", () => {
  it("maps female edge voices (Xiaoxiao / Aria) to nova", () => {
    expect(mapVoiceToOpenAi("zh-CN-XiaoxiaoNeural")).toBe("nova");
    expect(mapVoiceToOpenAi("en-US-AriaNeural")).toBe("nova");
  });

  it("maps male edge voices (Yunjian / Guy) to onyx", () => {
    expect(mapVoiceToOpenAi("en-US-GuyNeural")).toBe("onyx");
    expect(mapVoiceToOpenAi("zh-CN-YunjianNeural")).toBe("onyx");
  });

  it("passes through an already-valid OpenAI voice unchanged", () => {
    expect(mapVoiceToOpenAi("nova")).toBe("nova");
    expect(mapVoiceToOpenAi("onyx")).toBe("onyx");
    expect(mapVoiceToOpenAi("shimmer")).toBe("shimmer");
  });

  it("defaults unknown voices to nova", () => {
    expect(mapVoiceToOpenAi("totally-unknown-voice")).toBe("nova");
  });
});

describe("synthesizeOpenAiTts (testable core)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "openai-tts-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("happy path: writes returned bytes to outputPath", async () => {
    const fakeBytes = Buffer.from("ID3...fake-mp3-bytes");
    const { fn } = fetchReturning(
      new Response(fakeBytes, { status: 200, statusText: "OK" }),
    );
    const out = join(workDir, "out.mp3");
    const res = await synthesizeOpenAiTts(
      { text: "你好，世界", voice: "zh-CN-XiaoxiaoNeural", outputPath: out },
      { fetch: fn, env: { OPENAI_API_KEY: "sk-test" } },
    );
    expect(res.outputPath).toBe(out);
    expect(res.sampleRate).toBe(24000);
    expect(res.channels).toBe(1);
    const onDisk = await readFile(out);
    expect(onDisk.equals(fakeBytes)).toBe(true);
  });

  it("sends the mapped voice + response_format mp3 in the request body", async () => {
    const { fn, calls } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await synthesizeOpenAiTts(
      { text: "hello", voice: "en-US-GuyNeural", outputPath: join(workDir, "o.mp3") },
      { fetch: fn, env: { OPENAI_API_KEY: "sk-test" } },
    );
    const init = calls[0]?.[1];
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent.voice).toBe("onyx"); // Guy → onyx
    expect(sent.response_format).toBe("mp3");
    expect(sent.input).toBe("hello");
    expect(sent.model).toBe("tts-1");
  });

  it("prefers OPENAI_API_KEY over OPENROUTER_API_KEY", async () => {
    const { fn, calls } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await synthesizeOpenAiTts(
      { text: "x", voice: "nova", outputPath: join(workDir, "o.mp3") },
      { fetch: fn, env: { OPENAI_API_KEY: "sk-openai", OPENROUTER_API_KEY: "sk-or" } },
    );
    const headers = calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-openai");
  });

  it("throws when no API key is in env", async () => {
    const { fn } = fetchReturning(
      new Response(Buffer.from("x"), { status: 200, statusText: "OK" }),
    );
    await expect(
      synthesizeOpenAiTts(
        { text: "x", voice: "nova", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: {} },
      ),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("surfaces a non-2xx response as an error", async () => {
    const { fn } = fetchReturning(
      new Response("auth failed", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(
      synthesizeOpenAiTts(
        { text: "x", voice: "nova", outputPath: join(workDir, "o.mp3") },
        { fetch: fn, env: { OPENAI_API_KEY: "sk-bad" } },
      ),
    ).rejects.toThrow(/OpenAI TTS request failed: 401/);
  });
});

describe("openaiTtsProvider.isAvailable", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("is true when OPENAI_API_KEY is set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    expect(await openaiTtsProvider.isAvailable!()).toBe(true);
  });

  it("is true when only OPENROUTER_API_KEY is set", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or";
    expect(await openaiTtsProvider.isAvailable!()).toBe(true);
  });

  it("is false when neither key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(await openaiTtsProvider.isAvailable!()).toBe(false);
  });
});
