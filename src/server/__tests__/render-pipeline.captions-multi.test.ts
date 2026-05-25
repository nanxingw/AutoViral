// Phase H (issue #35) — multi-subtitle render-pipeline tests.
//
// Exercises the captionTracks option end-to-end at the pipeline level:
//   • Stage 1 (Remotion) receives a comp with only the burn-flagged text
//     track surviving — sidecar tracks are dropped so they don't
//     double-render on top of the burned lane.
//   • After the final mp4 is written, sidecar SRTs land next to it with
//     the `<output>.<lang>.srt` naming convention, well-formed (1-based
//     sequence, HH:MM:SS,mmm timecodes, blank line between cues, UTF-8).
//   • Caption tracks tagged with no language fall back to ISO 639-2 "und"
//     in the sidecar filename.
//   • "Both off" path: a text track in neither burn nor sidecar lists is
//     dropped from render and produces no sidecar file.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock heavy deps so the pipeline stays fast and deterministic. We
// capture the comp handed to renderCompositionToMp4 so the test can
// assert exactly which tracks Remotion saw.
vi.mock("../remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(
    async (_c: any, outDir: string) => `${outDir}/render-intermediate.mp4`,
  ),
}));
// audio-tools lives at src/audio-tools.ts; the path render-pipeline.ts
// uses to import is `../audio-tools.js`, but vi.mock paths resolve
// relative to the test file (src/server/__tests__/...), so this needs
// two `..` segments.
vi.mock("../../audio-tools.js", async (orig) => {
  const real = await orig<typeof import("../../audio-tools.js")>();
  return {
    ...real,
    mixAudioTracks: vi.fn(async () => undefined),
    normalizeLufs: vi.fn(async () => undefined),
    burnSubtitles: vi.fn(async () => undefined),
  };
});
// Mock node:fs/promises so the rename at the end of runRenderPipeline
// doesn't ENOENT on the synthetic intermediate path (the renderer is
// mocked so no actual file exists). We pass through real implementations
// for everything else (mkdtemp, readFile, readdir, stat, writeFile) since
// the test asserts on the sidecar SRT files actually landing on disk.
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(async () => undefined) };
});
// Stub child_process spawn so runEncodeStage doesn't shell out to ffmpeg.
// Auto-emit a close event (code 0) on next tick so hasMeaningfulAudio's
// volumedetect probe resolves immediately rather than hanging the test.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => undefined;
    setImmediate(() => proc.emit("close", 0));
    return proc;
  }),
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (e: any, o: string, s: string) => void) => {
      if (typeof cb === "function") cb(null, "", "");
    },
  ),
}));

import { readFileSync } from "node:fs";
import { runRenderPipeline, textTrackToSrt } from "../render-pipeline.js";
import { renderCompositionToMp4 } from "../remotion-renderer.js";

const renderMockFn = renderCompositionToMp4 as unknown as ReturnType<typeof vi.fn>;

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "shared",
  "__tests__",
  "fixtures",
  "composition-multi-subtitle.yaml",
);

function loadFixture() {
  return yaml.load(readFileSync(FIXTURE_PATH, "utf-8")) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-install the renderer default after clearAllMocks wipes implementations.
  renderMockFn.mockImplementation(
    async (_c: any, outDir: string) => `${outDir}/render-intermediate.mp4`,
  );
  // Force software-codec choice (no real ffmpeg) the same way the existing
  // pipeline tests do.
  process.env.AUTOVIRAL_FAKE_ENCODERS =
    "libx264,libx265,libvpx-vp9,libaom-av1";
  void import("../render/gpu-encoder.js").then((m) =>
    m._resetEncoderCacheForTests(),
  );
});

describe("textTrackToSrt — pure SRT serialiser", () => {
  it("emits 1-based sequence numbers and HH:MM:SS,mmm timecodes", () => {
    const srt = textTrackToSrt({
      clips: [
        { kind: "text", text: "Hello", trackOffset: 0, duration: 1.5 },
        { kind: "text", text: "World", trackOffset: 1.5, duration: 2.5 },
      ],
    });
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello");
    expect(srt).toContain("2\n00:00:01,500 --> 00:00:04,000\nWorld");
  });

  it("sorts cues by trackOffset before numbering", () => {
    const srt = textTrackToSrt({
      clips: [
        { kind: "text", text: "Second", trackOffset: 2, duration: 1 },
        { kind: "text", text: "First", trackOffset: 0, duration: 1 },
      ],
    });
    const firstIdx = srt.indexOf("First");
    const secondIdx = srt.indexOf("Second");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("ignores non-text clips and emits an empty body for empty input", () => {
    expect(textTrackToSrt({ clips: [] })).toBe("");
    expect(
      textTrackToSrt({
        clips: [{ kind: "audio", trackOffset: 0, duration: 1 } as any],
      }),
    ).toBe("");
  });
});

describe("runRenderPipeline — captionTracks: zh burn + en sidecar", () => {
  it("filters sidecar tracks out of Stage 1 input and writes the en SRT", async () => {
    const comp = loadFixture();
    const outDir = await mkdtemp(join(tmpdir(), "autoviral-captions-multi-"));
    renderMockFn.mockImplementation(async (_c, dir) => join(dir, "render-intermediate.mp4"));

    const outputPath = await runRenderPipeline({
      comp,
      outDir,
      captionTracks: {
        burnTrackId: "trk_t0000001", // zh
        sidecarTrackIds: ["trk_t0000002"], // en
      },
    });

    // Stage 1 saw the zh track but NOT the en track.
    const stage1Comp = renderMockFn.mock.calls[0]![0] as any;
    const stage1TextIds = (stage1Comp.tracks as any[])
      .filter((t) => t.kind === "text")
      .map((t) => t.id);
    expect(stage1TextIds).toEqual(["trk_t0000001"]);

    // Sidecar SRT lives next to the mp4 with the language tag in the name.
    const base = outputPath.replace(/\.mp4$/, "");
    const enSrtPath = `${base}.en.srt`;
    const enSrt = await readFile(enSrtPath, "utf-8");
    // Well-formed: cue #1 with the right body and a valid SRT timecode.
    expect(enSrt).toMatch(/^1\r?\n/);
    expect(enSrt).toMatch(/00:00:00,000 --> 00:00:04,000/);
    expect(enSrt).toContain("Today we talk about AI");

    // No zh sidecar — the zh track was burned, not sidecar'd.
    await expect(stat(`${base}.zh.srt`)).rejects.toThrow();
  });

  it("falls back to 'und' for tracks without a language tag", async () => {
    const comp = loadFixture();
    // Strip language off the second track so the sidecar filename has to
    // fall back to ISO 639-2 "und" (the agreed convention in #35).
    comp.tracks = comp.tracks.map((t: any) =>
      t.id === "trk_t0000002" ? { ...t, language: undefined } : t,
    );
    const outDir = await mkdtemp(join(tmpdir(), "autoviral-captions-und-"));
    renderMockFn.mockImplementation(async (_c, dir) => join(dir, "render-intermediate.mp4"));

    const outputPath = await runRenderPipeline({
      comp,
      outDir,
      captionTracks: { burnTrackId: null, sidecarTrackIds: ["trk_t0000002"] },
    });

    const undPath = `${outputPath.replace(/\.mp4$/, "")}.und.srt`;
    expect((await stat(undPath)).isFile()).toBe(true);
  });

  it("'both off' path: track is dropped from render AND no sidecar emitted", async () => {
    const comp = loadFixture();
    const outDir = await mkdtemp(join(tmpdir(), "autoviral-captions-bothoff-"));
    renderMockFn.mockImplementation(async (_c, dir) => join(dir, "render-intermediate.mp4"));

    const outputPath = await runRenderPipeline({
      comp,
      outDir,
      captionTracks: {
        burnTrackId: "trk_t0000001",
        sidecarTrackIds: [], // en track is in neither bucket → dropped
      },
    });

    // Stage 1 only saw the zh track; en was dropped silently as designed.
    const stage1Comp = renderMockFn.mock.calls[0]![0] as any;
    const textIds = (stage1Comp.tracks as any[])
      .filter((t) => t.kind === "text")
      .map((t) => t.id);
    expect(textIds).toEqual(["trk_t0000001"]);

    // No sidecar files in outDir.
    const baseName = outputPath.split("/").pop()!.replace(/\.mp4$/, "");
    const files = await readdir(outDir);
    const sidecars = files.filter(
      (f) => f.startsWith(baseName) && f.endsWith(".srt"),
    );
    expect(sidecars).toEqual([]);
  });
});

describe("runRenderPipeline — legacy single-track path unchanged", () => {
  it("when captionTracks is omitted, every text track survives into Stage 1", async () => {
    const comp = loadFixture();
    const outDir = await mkdtemp(join(tmpdir(), "autoviral-captions-legacy-"));
    renderMockFn.mockImplementation(async (_c, dir) => join(dir, "render-intermediate.mp4"));

    await runRenderPipeline({ comp, outDir });

    const stage1Comp = renderMockFn.mock.calls[0]![0] as any;
    const textIds = (stage1Comp.tracks as any[])
      .filter((t) => t.kind === "text")
      .map((t) => t.id);
    expect(textIds).toEqual(["trk_t0000001", "trk_t0000002"]);
  });
});
