import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy deps so the pipeline test runs in <1s
vi.mock("./remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(async (_comp, outDir) => `${outDir}/render-intermediate.mp4`),
}));
vi.mock("../audio-tools.js", async (orig) => {
  const real = await orig<typeof import("../audio-tools.js")>();
  return {
    ...real,
    mixAudioTracks: vi.fn(async (_opts) => undefined),
    normalizeLufs: vi.fn(async (_in, _out, _opts) => undefined),
    burnSubtitles: vi.fn(async (_opts) => undefined),
  };
});
// Mock rename so the pipeline's final stage doesn't ENOENT on the synthetic
// upstream path (no actual files exist when upstream stages are mocked).
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(async () => undefined) };
});

import { runRenderPipeline } from "./render-pipeline.js";
import { renderCompositionToMp4 } from "./remotion-renderer.js";
import { mixAudioTracks, normalizeLufs, burnSubtitles } from "../audio-tools.js";
import type { Composition } from "../shared/composition.js";

const baseComp: Composition = {
  id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
  duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
  tracks: [], assets: [], provenance: [], exportPresets: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRenderPipeline — minimal pipeline (no ducking, no burn)", () => {
  it("calls renderCompositionToMp4 then normalizeLufs (default -14)", async () => {
    const out = await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    expect(renderCompositionToMp4).toHaveBeenCalledOnce();
    expect(normalizeLufs).toHaveBeenCalledOnce();
    expect(mixAudioTracks).not.toHaveBeenCalled();
    expect(burnSubtitles).not.toHaveBeenCalled();
    expect(out).toMatch(/\.mp4$/);
  });
});

describe("runRenderPipeline — with ducking", () => {
  const compWithDuck: Composition = {
    ...baseComp,
    tracks: [
      { id: "audio-bgm", kind: "audio", label: "BGM", muted: false, hidden: false,
        clips: [{ id: "a1", kind: "audio", src: "/bgm.mp3", in: 0, out: 4, trackOffset: 0,
                  volume: 1, fadeIn: 0, fadeOut: 0, type: "bgm",
                  ducking: { ratio: 4, attack: 200, release: 1000 } }] },
      { id: "audio-vo", kind: "audio", label: "VO", muted: false, hidden: false,
        clips: [{ id: "a2", kind: "audio", src: "/vo.mp3", in: 0, out: 4, trackOffset: 0,
                  volume: 1, fadeIn: 0, fadeOut: 0, type: "voiceover" }] },
    ],
  };

  it("calls mixAudioTracks once when any AudioClip has ducking", async () => {
    await runRenderPipeline({ comp: compWithDuck, outDir: "/tmp/out" });
    expect(mixAudioTracks).toHaveBeenCalledOnce();
    const callArg = (mixAudioTracks as any).mock.calls[0][0];
    expect(callArg.tracks).toHaveLength(2);
    const bgmTrack = callArg.tracks.find((t: any) => t.type === "bgm");
    expect(bgmTrack.ducking).toEqual({ trigger: "voiceover", ratio: 4 });
  });
});

describe("runRenderPipeline — with burn-in subtitles", () => {
  const compWithText: Composition = {
    ...baseComp,
    tracks: [
      { id: "text-0", kind: "text", label: "Subtitles", muted: false, hidden: false,
        clips: [{ id: "t1", kind: "text", text: "Hi", trackOffset: 0, duration: 2,
                  style: { font: "Inter", size: 48, weight: 700, italic: false, tracking: 0, color: "#fff" },
                  position: { anchor: "bottom", xPct: 50, yPct: 85 } }] },
    ],
  };

  it("calls burnSubtitles when burnSubtitles option is true and there is a text track", async () => {
    await runRenderPipeline({ comp: compWithText, outDir: "/tmp/out", burnSubtitles: true });
    expect(burnSubtitles).toHaveBeenCalledOnce();
  });

  it("skips burnSubtitles when burnSubtitles=false (default)", async () => {
    await runRenderPipeline({ comp: compWithText, outDir: "/tmp/out" });
    expect(burnSubtitles).not.toHaveBeenCalled();
  });

  it("throws when burnSubtitles=true but the composition has no text track", async () => {
    // baseComp has tracks: [] — no text track
    await expect(
      runRenderPipeline({ comp: baseComp, outDir: "/tmp/out", burnSubtitles: true }),
    ).rejects.toThrow(/burnSubtitles=true but the composition has no text-track/);
  });
});

describe("runRenderPipeline — onProgress hook", () => {
  it("emits stage events: render → loudnorm → encode (minimal)", async () => {
    const stages: string[] = [];
    await runRenderPipeline({
      comp: baseComp,
      outDir: "/tmp/out",
      onProgress: (s) => stages.push(s),
    });
    expect(stages).toContain("render");
    expect(stages).toContain("loudnorm");
    expect(stages).toContain("encode");
  });
});
