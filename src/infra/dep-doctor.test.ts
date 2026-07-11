import { describe, expect, it, vi } from "vitest";
import { runDoctor, runSetup } from "./dep-doctor.js";
import type { DepResolution } from "./deps.js";

function res(source: DepResolution["source"], path: string): DepResolution {
  return {
    path,
    source,
    managedPath: "/x/.autoviral/bin/x",
    managedExists: source === "managed",
    vendoredPath: source === "vendored" ? path : null,
  };
}

const coreOk = () => ({
  ffmpeg: res("vendored", "/vendor/ffmpeg"),
  ffprobe: res("vendored", "/vendor/ffprobe"),
});

describe("runDoctor — active dependency surface", () => {
  it("reports active dependencies without retired collector or trend Playwright setup", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: coreOk,
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (name) => `/x/.autoviral/tts-venv/bin/${name}`,
      binaryOnPath: () => false,
      resolveClaude: () => "/usr/local/bin/claude",
      remotionEntry: () => ({ ready: true, via: "bundle", path: "/app/remotion" }),
      out,
    });

    expect(code).toBe(0);
    const printed = out.mock.calls.map((call) => call[0]).join("\n");
    expect(printed).toMatch(/ffmpeg|ffprobe|tts venv|claude CLI|remotion/);
    expect(printed).not.toMatch(/collector|playwright|--heavy|trends scrape/);
  });

  it("returns 1 when a core binary is unavailable", async () => {
    const code = await runDoctor({
      detect: () => ({ ffmpeg: res("path", "ffmpeg"), ffprobe: res("path", "ffprobe") }),
      binaryOnPath: () => false,
      remotionEntry: () => ({ ready: true, via: "bundle", path: "/app/remotion" }),
      out: vi.fn(),
    });
    expect(code).toBe(1);
  });
});

describe("runSetup — active provisioners", () => {
  it("installs only managed media tools and the TTS venv", async () => {
    const ensureManaged = vi.fn(async () => {});
    const ensureTtsVenv = vi.fn(async () => {});
    const out = vi.fn();

    const code = await runSetup({
      ensureManaged,
      ensureTtsVenv,
      detect: coreOk,
      binaryOnPath: () => false,
      out,
    });

    expect(code).toBe(0);
    expect(ensureManaged).toHaveBeenCalledOnce();
    expect(ensureTtsVenv).toHaveBeenCalledOnce();
    expect(out.mock.calls.map((call) => call[0]).join("\n")).not.toMatch(
      /collector|playwright|--heavy|trends scrape/,
    );
  });
});
