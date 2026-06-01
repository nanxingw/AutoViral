import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize, TtsConfigError } from "../index.js";

describe("TTS provider (H4.1)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "tts-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("rejects empty text", async () => {
    await expect(
      synthesize({
        text: "",
        workDir,
        env: { OPENAI_API_KEY: "sk-test" },
      }),
    ).rejects.toThrow(TtsConfigError);
  });

  it("requires an API key in env", async () => {
    await expect(
      synthesize({ text: "hello", workDir, env: {} }),
    ).rejects.toThrow(TtsConfigError);
  });

  it("happy path: writes mp3 to assets/audio/ and returns relativeUri", async () => {
    const fakeBytes = Buffer.from("ID3...fake-mp3-bytes");
    const fetchMock = vi.fn(
      async () =>
        new Response(fakeBytes, { status: 200, statusText: "OK" }) as Response,
    );
    const res = await synthesize({
      text: "Hello, narrator.",
      workDir,
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(res.format).toBe("mp3");
    expect(res.voice).toBe("alloy");
    expect(res.bytes).toBe(fakeBytes.byteLength);
    expect(res.relativeUri).toMatch(/^assets\/audio\/[0-9a-f]+\.mp3$/);
    const onDisk = await readFile(res.assetPath);
    expect(onDisk.equals(fakeBytes)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects voice + format overrides", async () => {
    const fakeBytes = Buffer.from("WAV-fake");
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof globalThis.fetch>) =>
        new Response(fakeBytes, { status: 200, statusText: "OK" }) as Response,
    );
    const res = await synthesize({
      text: "Test",
      voice: "nova",
      format: "wav",
      workDir,
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(res.voice).toBe("nova");
    expect(res.format).toBe("wav");
    expect(res.relativeUri).toMatch(/\.wav$/);

    // Verify the request body matches
    const callArgs = fetchMock.mock.calls[0]?.[1];
    const body = callArgs?.body;
    expect(typeof body).toBe("string");
    const sent = JSON.parse(body as string) as Record<string, unknown>;
    expect(sent.voice).toBe("nova");
    expect(sent.response_format).toBe("wav");
    expect(sent.input).toBe("Test");
  });

  it("uses filenameStem override when provided", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.from("x"), { status: 200, statusText: "OK" }) as Response,
    );
    const res = await synthesize({
      text: "X",
      filenameStem: "my-clip",
      workDir,
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(res.relativeUri).toBe("assets/audio/my-clip.mp3");
    const s = await stat(res.assetPath);
    expect(s.isFile()).toBe(true);
  });

  it("hash-based stem is deterministic for identical input", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.from("x"), { status: 200, statusText: "OK" }) as Response,
    );
    const first = await synthesize({
      text: "deterministic",
      workDir,
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const second = await synthesize({
      text: "deterministic",
      workDir,
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(first.relativeUri).toBe(second.relativeUri);
  });

  it("surfaces non-2xx as a normal Error (not TtsConfigError)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("auth failed", {
          status: 401,
          statusText: "Unauthorized",
        }) as Response,
    );
    await expect(
      synthesize({
        text: "x",
        workDir,
        env: { OPENAI_API_KEY: "sk-bad" },
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/TTS request failed: 401/);
  });

  it("prefers OPENAI_API_KEY over OPENROUTER_API_KEY when both are set", async () => {
    const fetchMock = vi.fn(
      async (..._args: Parameters<typeof globalThis.fetch>) =>
        new Response(Buffer.from("x"), { status: 200, statusText: "OK" }) as Response,
    );
    await synthesize({
      text: "x",
      workDir,
      env: {
        OPENAI_API_KEY: "sk-openai",
        OPENROUTER_API_KEY: "sk-or",
      },
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer sk-openai");
  });
});
