import { describe, it, expect } from "vitest";
import { mapExpressiveTagsToSsml, edgeTtsProvider } from "../edge-tts.js";
import { pickProvider } from "../registry.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";

describe("mapExpressiveTagsToSsml", () => {
  it("converts [sigh] to a 400ms break", () => {
    const r = mapExpressiveTagsToSsml("Hello [sigh] world");
    expect(r).toContain('<break time="400ms"/>');
    expect(r).toContain("Hello");
    expect(r).toContain("world");
  });

  it("converts [laughing] to a 600ms break (longer for emphasis)", () => {
    const r = mapExpressiveTagsToSsml("Funny [laughing] story");
    expect(r).toContain('<break time="600ms"/>');
  });

  it("converts [whisper]...[/whisper] to a prosody volume tag", () => {
    const r = mapExpressiveTagsToSsml("Speak [whisper]quietly[/whisper] now");
    expect(r).toMatch(/<prosody volume="x-soft">quietly<\/prosody>/);
  });

  it("preserves text without any tags unchanged", () => {
    expect(mapExpressiveTagsToSsml("plain text")).toBe("plain text");
  });

  it("escapes XML-significant chars when wrapping in SSML", () => {
    const r = mapExpressiveTagsToSsml("AT&T <html> stuff");
    expect(r).toContain("AT&amp;T");
    expect(r).toContain("&lt;html&gt;");
  });
});

describe("pickProvider", () => {
  it("picks edge-tts as the default fallback", () => {
    const p = pickProvider({ language: "zh-CN" });
    expect(p.id).toBe("edge-tts");
  });

  it("returns edge-tts for any language (only MVP provider available)", () => {
    expect(pickProvider({ language: "en-US" }).id).toBe("edge-tts");
    expect(pickProvider({ language: "ja-JP" }).id).toBe("edge-tts");
  });
});

describe("edgeTtsProvider.generate (smoke)", () => {
  const skip = process.env.SKIP_TTS_SMOKE === "1";
  it.skipIf(skip)("produces an audio file from a 1-line prompt", async () => {
    const out = join(tmpdir(), `tts-${Date.now()}.mp3`);
    const r = await edgeTtsProvider.generate({
      text: "Hello world from AutoViral",
      voice: "en-US-AriaNeural",
      outputPath: out,
    });
    expect(r.outputPath).toBe(out);
    const s = await stat(out);
    expect(s.size).toBeGreaterThan(1000);
    expect(r.duration).toBeGreaterThan(0);
  }, 30_000);
});
