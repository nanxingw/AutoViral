import { describe, it, expect } from "vitest";
import { normalizeLufs, parseLoudnormJson, measureLufs } from "./audio-tools.js";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseLoudnormJson", () => {
  it("extracts the JSON block from ffmpeg loudnorm pass-1 stderr", () => {
    const stderr = `
[Parsed_loudnorm_0 @ 0x600003fa4000]
{
        "input_i" : "-30.45",
        "input_tp" : "-19.83",
        "input_lra" : "0.00",
        "input_thresh" : "-40.46",
        "output_i" : "-15.00",
        "output_tp" : "-1.51",
        "output_lra" : "0.00",
        "output_thresh" : "-25.07",
        "normalization_type" : "dynamic",
        "target_offset" : "-1.00"
}
size=N/A time=00:00:01.00 bitrate=N/A
`;
    const r = parseLoudnormJson(stderr);
    expect(r).not.toBeNull();
    expect(r!.input_i).toBe("-30.45");
    expect(r!.input_thresh).toBe("-40.46");
  });

  it("returns null when no loudnorm block is present", () => {
    expect(parseLoudnormJson("plain ffmpeg output without loudnorm")).toBeNull();
  });
});

describe("normalizeLufs (integration)", () => {
  it("normalizes a -30 LUFS source to within ±0.5 LU of -14 target", async () => {
    const inFile = join(process.cwd(), "tests/fixtures/quiet-tone.wav");
    const outFile = join(tmpdir(), `normalized-${Date.now()}.wav`);

    await normalizeLufs(inFile, outFile, {
      target: -14,
      truePeak: -1.5,
      lra: 11,
    });

    const s = await stat(outFile);
    expect(s.size).toBeGreaterThan(0);

    const measured = await measureLufs(outFile);
    expect(measured).toBeGreaterThan(-14.5);
    expect(measured).toBeLessThan(-13.5);
  }, 30_000);
});

describe("measureLufs", () => {
  it("returns the integrated loudness of a known -27 LUFS source", async () => {
    const inFile = join(process.cwd(), "tests/fixtures/quiet-tone.wav");
    const r = await measureLufs(inFile);
    expect(typeof r).toBe("number");
    // Fixture is a 1kHz tone at volume=0.5 → ~-27.15 LUFS on ffmpeg 8.x. Allow ±1 LU drift across versions.
    expect(r).toBeGreaterThan(-28.5);
    expect(r).toBeLessThan(-26);
  }, 15_000);
});
