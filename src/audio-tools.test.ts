import { describe, it, expect } from "vitest";
import {
  normalizeLufs,
  parseLoudnormJson,
  measureLufs,
  compositionTextTrackToJson,
  assertFontInstalled,
} from "./audio-tools.js";
import { stat, mkdtemp, writeFile, rm } from "node:fs/promises";
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

// ─── Phase 3.B — burnSubtitles helpers ────────────────────────────────────

describe("compositionTextTrackToJson", () => {
  it("emits flat-list shape from a Composition's first text track", () => {
    // Minimal structurally-typed Composition. The adapter's input type is
    // structural-loose (only reads tracks/clips), so 'as any' is fine here
    // and avoids dragging in the full CompositionSchema field set.
    const c = {
      tracks: [
        {
          id: "video-0",
          kind: "video",
          label: "Video",
          muted: false,
          hidden: false,
          clips: [],
        },
        {
          id: "text-0",
          kind: "text",
          label: "Subtitles",
          muted: false,
          hidden: false,
          clips: [
            // Intentionally out-of-order to verify sort.
            {
              id: "t2",
              kind: "text",
              text: "Line 2",
              trackOffset: 2.5,
              duration: 1.8,
            },
            {
              id: "t1",
              kind: "text",
              text: "Line 1",
              trackOffset: 0,
              duration: 2,
            },
          ],
        },
      ],
    } as any;
    const r = compositionTextTrackToJson(c);
    expect(r).toEqual([
      { start: 0, end: 2, text: "Line 1" },
      { start: 2.5, end: 4.3, text: "Line 2" },
    ]);
  });

  it("returns empty array when the comp has no text track", () => {
    const c = { tracks: [] } as any;
    expect(compositionTextTrackToJson(c)).toEqual([]);
  });
});

describe("assertFontInstalled", () => {
  it("returns the path when the font file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoviral-fonttest-"));
    const fakeFont = join(dir, "fake.otf");
    await writeFile(fakeFont, "x");
    try {
      expect(await assertFontInstalled(fakeFont)).toBe(fakeFont);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the font is missing", async () => {
    await expect(assertFontInstalled("/nonexistent/font.otf")).rejects.toThrow(
      /AUTOVIRAL_FONT_PATH|NotoSansCJK/,
    );
  });
});
