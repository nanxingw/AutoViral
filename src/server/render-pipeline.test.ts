import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

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
// Mock node:child_process so runEncodeStage doesn't actually invoke ffmpeg.
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

import { spawn } from "node:child_process";
import { runRenderPipeline, runEncodeStage } from "./render-pipeline.js";
import { renderCompositionToMp4 } from "./remotion-renderer.js";
import { mixAudioTracks, normalizeLufs, burnSubtitles } from "../audio-tools.js";
import type { Composition, ExportPreset } from "../shared/composition.js";

const _spawn = spawn as unknown as ReturnType<typeof vi.fn>;

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

const douyin: ExportPreset = {
  id: "douyin-9-16",
  label: "抖音 9:16",
  platform: "douyin",
  width: 1080, height: 1920, fps: 30,
  codec: "h264", container: "mp4",
  videoBitrate: 8000, audioBitrate: 192,
  loudnessTargetLufs: -14, safeZonePct: 0.18,
};

describe("runEncodeStage", () => {
  beforeEach(() => { _spawn.mockClear(); });

  it("AC2 — builds an ffmpeg command with -c:v libx264 -b:v 8000k for the douyin preset", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    expect(_spawn).toHaveBeenCalledOnce();
    expect(_spawn.mock.calls[0][0]).toBe("ffmpeg");
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("-i");
    expect(args).toContain("/in.mp4");
    expect(args).toContain("-c:v");
    expect(args).toContain("libx264");
    expect(args).toContain("-b:v");
    expect(args).toContain("8000k");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args).toContain("-b:a");
    expect(args).toContain("192k");
    expect(args[args.length - 1]).toBe("/out.mp4");
  });

  it("maps codec names: h265 → libx265", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "h265" });
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libx265");
  });

  it("maps codec names: vp9 → libvpx-vp9", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "vp9" });
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libvpx-vp9");
  });

  it("maps codec names: av1 → libaom-av1", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "av1" });
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libaom-av1");
  });

  it("rejects when ffmpeg exits non-zero, including stderr", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    const proc = _spawn.mock.results[0].value;
    proc.stderr.emit("data", Buffer.from("encoder boom"));
    proc.emit("close", 2);
    await expect(promise).rejects.toThrow(/encoder boom/);
  });
});

describe("runEncodeStage — abort signal", () => {
  it("kills the spawned ffmpeg process when the AbortSignal fires", async () => {
    _spawn.mockClear();
    const ac = new AbortController();
    let killed = false;
    _spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        killed = true;
        proc.emit("close", 130);
      };
      return proc;
    });
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin, ac.signal);
    // Abort on the next tick so the spawn has registered its abort listener.
    setTimeout(() => ac.abort(), 0);
    await expect(promise).rejects.toThrow(/aborted/);
    expect(killed).toBe(true);
  });
});

describe("runRenderPipeline — encode stage wiring", () => {
  it("invokes ffmpeg via spawn when comp.exportPresets[0] is present", async () => {
    _spawn.mockClear();
    const compWithPreset: Composition = { ...baseComp, exportPresets: [douyin] };
    const promise = runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out" });
    // Drive every spawned ffmpeg child to a clean exit.
    // We poll mock.results until at least one encode-stage spawn shows up,
    // then close it. The pipeline awaits the encode step inline, so we must
    // close the child synchronously on the next tick.
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const r of _spawn.mock.results) r.value.emit("close", 0);
    await promise;
    expect(_spawn).toHaveBeenCalled();
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libx264");
  });

  it("falls back to rename passthrough when comp.exportPresets is empty", async () => {
    _spawn.mockClear();
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    // baseComp has exportPresets: [], so spawn must NOT be called.
    expect(_spawn).not.toHaveBeenCalled();
  });
});

// Phase 8.3.E — speed-ramp pre-pass tests. For each VideoClip with a static
// non-1 speed, the pipeline invokes ffmpeg with `setpts=PTS/<k>` + chained
// `atempo` BEFORE Remotion renders. Variable-speed clips emit a warning and
// are not pre-passed.
describe("runRenderPipeline — speed-ramp pre-pass (Phase 8.3.E)", () => {
  // Drive every spawn child to a clean exit on the next tick. The pipeline
  // awaits each ffmpeg call inline, so we close children as soon as they're
  // spawned via setImmediate batches.
  async function drainSpawnsToClose(): Promise<void> {
    // Multiple drain rounds because each await boundary may trigger a fresh
    // spawn that wasn't visible on the previous tick.
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      for (const r of _spawn.mock.results) {
        const proc = r.value;
        if (!proc._closed) {
          proc._closed = true;
          proc.emit("close", 0);
        }
      }
    }
  }

  function makeVideoCompWithSpeed(
    clipId: string,
    speed: number | Array<{ time: number; value: number }>,
    src = "/src.mp4",
  ): Composition {
    const kfs = Array.isArray(speed)
      ? speed.map((p) => ({
          property: "speed" as const,
          time: p.time,
          value: p.value,
          easing: "linear" as const,
        }))
      : [
          { property: "speed" as const, time: 0, value: speed, easing: "linear" as const },
          { property: "speed" as const, time: 4, value: speed, easing: "linear" as const },
        ];
    return {
      ...baseComp,
      tracks: [
        {
          id: "video-0",
          kind: "video",
          label: "Video",
          muted: false,
          hidden: false,
          clips: [
            {
              id: clipId,
              kind: "video",
              src,
              in: 0,
              out: 4,
              trackOffset: 0,
              transforms: {},
              filters: {},
              keyframes: kfs,
            } as any,
          ],
        },
      ],
    };
  }

  it("static speed=2 invokes ffmpeg with setpts=PTS/2 and chained atempo", async () => {
    _spawn.mockClear();
    const comp = makeVideoCompWithSpeed("clip-1", 2.0);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-speed-2" });
    await drainSpawnsToClose();
    await promise;
    // First spawn call IS the speed pre-pass (Stage 0), before any other
    // ffmpeg-invoking stage.
    expect(_spawn).toHaveBeenCalled();
    const firstCall = _spawn.mock.calls[0];
    expect(firstCall[0]).toBe("ffmpeg");
    const args = firstCall[1] as string[];
    const filterIdx = args.indexOf("-filter_complex");
    expect(filterIdx).toBeGreaterThan(-1);
    const filter = args[filterIdx + 1];
    expect(filter).toContain("setpts=PTS/2");
    expect(filter).toContain("atempo=2.0000");
    // Output filename should encode the clip id + speed for caching.
    const output = args[args.length - 1];
    expect(output).toContain("clip-1-speed-200.mp4");
  });

  it("static speed=0.5 invokes ffmpeg with setpts=PTS/0.5 and atempo=0.5", async () => {
    _spawn.mockClear();
    const comp = makeVideoCompWithSpeed("clip-1", 0.5);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-speed-0_5" });
    await drainSpawnsToClose();
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1];
    expect(filter).toContain("setpts=PTS/0.5");
    expect(filter).toContain("atempo=0.5000");
    expect(args[args.length - 1]).toContain("clip-1-speed-50.mp4");
  });

  it("static speed=4.0 chains atempo=2.0,atempo=2.0", async () => {
    _spawn.mockClear();
    const comp = makeVideoCompWithSpeed("clip-1", 4.0);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-speed-4" });
    await drainSpawnsToClose();
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("setpts=PTS/4");
    // chainAtempo(4) → "atempo=2.0000,atempo=2.0000"
    expect(filter).toContain("atempo=2.0000,atempo=2.0000");
  });

  it("variable speed → warning emitted, no setpts pre-pass spawned", async () => {
    _spawn.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Two distinct keyframe values → variable speed (D6 falls back to 1×)
    const comp = makeVideoCompWithSpeed("clip-1", [
      { time: 0, value: 1.0 },
      { time: 4, value: 2.0 },
    ]);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-var" });
    await drainSpawnsToClose();
    await promise;
    // None of the spawned ffmpeg invocations should be a speed pass —
    // i.e. their filter_complex args don't mention setpts=PTS/.
    for (const call of _spawn.mock.calls) {
      const args = call[1] as string[];
      const filterIdx = args.indexOf("-filter_complex");
      const filter = filterIdx >= 0 ? (args[filterIdx + 1] as string) : "";
      expect(filter).not.toContain("setpts=PTS/");
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Variable-speed export/i),
    );
    warnSpy.mockRestore();
  });
});

describe("runRenderPipeline — proxy mode (Phase 7.C)", () => {
  it("halves width/height (rounded to even) and clamps fps to 24 in the Remotion render call", async () => {
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out", proxy: true });
    const renderMock = renderCompositionToMp4 as unknown as ReturnType<typeof vi.fn>;
    const compArg = renderMock.mock.calls[0]![0] as any;
    expect(compArg.width).toBe(540);
    expect(compArg.height).toBe(960);
    expect(compArg.fps).toBe(24);
  });

  it("halves preset.videoBitrate (audio bitrate kept) when proxy + preset", async () => {
    _spawn.mockClear();
    const compWithPreset: Composition = {
      ...baseComp,
      exportPresets: [{
        id: "p", label: "x", platform: "douyin",
        width: 1080, height: 1920, fps: 30,
        codec: "h264", container: "mp4",
        videoBitrate: 8000, audioBitrate: 192,
        loudnessTargetLufs: -14, safeZonePct: 0.18,
      }],
    };
    const promise = runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out", proxy: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const r of _spawn.mock.results) r.value.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0]![1] as string[];
    const bvIdx = args.indexOf("-b:v");
    expect(args[bvIdx + 1]).toBe("4000k"); // halved from 8000
    const baIdx = args.indexOf("-b:a");
    expect(args[baIdx + 1]).toBe("192k");  // kept
  });
});
