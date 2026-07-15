import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock the heavy deps so the pipeline test runs in <1s
vi.mock("./remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(async (_comp, outDir) => `${outDir}/render-intermediate.mp4`),
}));
vi.mock("../domain/audio-tools.js", async (orig) => {
  const real = await orig<typeof import("../domain/audio-tools.js")>();
  return {
    ...real,
    mixAudioTracks: vi.fn(async (_opts) => undefined),
    normalizeLufs: vi.fn(async (_in, _out, _opts) => undefined),
    burnSubtitles: vi.fn(async (_opts) => undefined),
  };
});
// Mock rename so the pipeline's final stage doesn't ENOENT on the synthetic
// upstream path (no actual files exist when upstream stages are mocked).
// S5 (issue #027) — also mock unlink so the post-export intermediate cleanup
// doesn't ENOENT on the same synthetic paths; everything else (stat, etc.)
// stays real so hasMeaningfulAudio's ENOENT-catch-true fallback still fires.
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  };
});
// Pin ffmpeg/ffprobe to their bare names. FFMPEG_BIN/FFPROBE_BIN now resolve
// through src/infra/deps.ts (env → managed → VENDORED absolute path → bare
// name); under test that yields the vendored node_modules path. These tests
// assert on the spawn TARGET being literally "ffmpeg", so we pin the names here
// — path-resolution precedence has its own coverage in src/infra/deps.test.ts.
vi.mock("./ffmpeg-paths.js", () => ({ FFMPEG_BIN: "ffmpeg", FFPROBE_BIN: "ffprobe" }));
// Mock node:child_process so runEncodeStage doesn't actually invoke ffmpeg.
// R46 — also stub execFile so gpu-encoder's detect path is callable
// (we keep encoder list deterministic via AUTOVIRAL_FAKE_ENCODERS env var
// instead of going through this mock — but we still need execFile/promisify
// to import without throwing).
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn((cmd?: string, args?: string[]) => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // S4 (PRD-0014) — the speed pre-pass now ffprobes for an audio stream
      // before building the setpts/atempo graph (silent-video guard). Answer
      // that probe with one audio-stream index so the graph keeps its audio
      // path; nextTick beats drainSpawnsUntilSettled's setImmediate close(0).
      const selIdx = args?.indexOf("-select_streams") ?? -1;
      if (cmd === "ffprobe" && selIdx >= 0 && args?.[selIdx + 1] === "a") {
        process.nextTick(() => proc.stdout.emit("data", Buffer.from("0\n")));
      }
      return proc;
    }),
    execFile: vi.fn((_cmd: string, _args: string[], cb: any) => {
      // gpu-encoder calls promisify(execFile) which uses (cmd, args, cb).
      // We don't actually need ffmpeg output here because tests using
      // runEncodeStage will set AUTOVIRAL_FAKE_ENCODERS, but the import
      // itself fails if execFile isn't exported.
      if (typeof cb === "function") cb(null, "", "");
    }),
  };
});

import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import {
  runRenderPipeline,
  runEncodeStage,
  __compositionToMixTracksForTest,
} from "./render-pipeline.js";
import { renderCompositionToMp4 } from "./remotion-renderer.js";
import { mixAudioTracks, normalizeLufs, burnSubtitles } from "../domain/audio-tools.js";
import type { Composition, ExportPreset } from "../shared/composition.js";

const _spawn = spawn as unknown as ReturnType<typeof vi.fn>;
const _unlink = unlink as unknown as ReturnType<typeof vi.fn>;

const baseComp: Composition = {
  id: "c", workId: "w", fps: 30, width: 1080, height: 1920,
  duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
  tracks: [], assets: [], provenance: [], exportPresets: [],
};

beforeEach(async () => {
  vi.clearAllMocks();
  // R46 — force software-encoder fallback in tests so we keep asserting
  // on stable codec names like `libx264`. Without this, tests would
  // pass on dev machines where ffmpeg has h264_videotoolbox / nvenc and
  // fail in CI (or vice-versa). AUTOVIRAL_FAKE_ENCODERS is a backdoor
  // gpu-encoder reads instead of probing ffmpeg.
  process.env.AUTOVIRAL_FAKE_ENCODERS = "libx264,libx265,libvpx-vp9,libaom-av1";
  // Reset cached detection between tests so the env var takes effect. Await it
  // — a fire-and-forget import could land the reset mid-test on a slow runner.
  const gpu = await import("./render/gpu-encoder.js");
  gpu._resetEncoderCacheForTests();
});

// Drive every spawned (mock) ffmpeg child to a clean exit until the pipeline
// promise settles. The pipeline awaits each ffmpeg call inline, but stages are
// separated by REAL async work (fs I/O — only `rename` is mocked above), so a
// FIXED number of drain rounds is a latency bet: on a loaded CI runner one fs
// callback landing after the last round leaves the next spawned child without
// a "close" forever → the pipeline hangs → 15s vitest timeout (chronic main-CI
// flake, victim test random within this file; reproduced locally by shrinking
// the old 8-round loop to 1). Draining UNTIL SETTLED is correct by
// construction: every event-loop turn closes whatever new children appeared,
// so the pipeline always progresses no matter how many turns real I/O takes.
// The round cap is a hang backstop far above anything real; vitest's timeout
// remains the final net.
async function drainSpawnsUntilSettled(
  spawnMock: ReturnType<typeof vi.fn>,
  promise: Promise<unknown>,
): Promise<void> {
  let settled = false;
  const tracked = promise.then(
    () => { settled = true; },
    () => { settled = true; }, // rejection is the caller's to assert
  );
  for (let i = 0; i < 100_000 && !settled; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const r of spawnMock.mock.results) {
      const proc = r.value;
      if (proc && !proc._closed) {
        proc._closed = true;
        proc.emit("close", 0);
      }
    }
  }
  await tracked;
}

describe("runRenderPipeline — minimal pipeline (no ducking, no burn)", () => {
  it("calls renderCompositionToMp4 then normalizeLufs (default -14)", async () => {
    const out = await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    expect(renderCompositionToMp4).toHaveBeenCalledOnce();
    expect(normalizeLufs).toHaveBeenCalledOnce();
    expect(mixAudioTracks).not.toHaveBeenCalled();
    expect(burnSubtitles).not.toHaveBeenCalled();
    expect(out).toMatch(/\.mp4$/);
  });

  it("forwards loudnessTargetLufs into normalizeLufs (S15 — preset LUFS really reaches loudnorm, NOT the -14 default)", async () => {
    // The /export route resolves a platform preset (e.g. 微信/-16) and passes
    // its loudnessTargetLufs here. This render-consumption assertion guards the
    // field from going dead again: the loudnorm stage must use it, not -14.
    await runRenderPipeline({
      comp: baseComp,
      outDir: "/tmp/out",
      loudnessTargetLufs: -16,
    });
    const normMock = normalizeLufs as unknown as ReturnType<typeof vi.fn>;
    expect(normMock).toHaveBeenCalledOnce();
    const optsArg = normMock.mock.calls[0]![2] as { target: number };
    expect(optsArg.target).toBe(-16);
  });

  it("defaults the loudnorm target to -14 when no override is supplied", async () => {
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    const normMock = normalizeLufs as unknown as ReturnType<typeof vi.fn>;
    const optsArg = normMock.mock.calls[0]![2] as { target: number };
    expect(optsArg.target).toBe(-14);
  });

  it("forwards the AbortSignal into the render call so RENDER can be cancelled mid-flight (#44)", async () => {
    // Before #44 the render stage ignored the signal — cancellation only took
    // effect at the next stage boundary. The pipeline must now hand the signal
    // to renderCompositionToMp4 (which bridges it onto Remotion's cancelSignal).
    const ac = new AbortController();
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out", signal: ac.signal });
    const renderMock = renderCompositionToMp4 as unknown as ReturnType<typeof vi.fn>;
    const optsArg = renderMock.mock.calls[0]![2] as { signal?: AbortSignal };
    expect(optsArg.signal).toBe(ac.signal);
  });
});

describe("runRenderPipeline — with ducking", () => {
  const compWithDuck: Composition = {
    ...baseComp,
    tracks: [
      { id: "audio-bgm", kind: "audio", label: "BGM", muted: false, hidden: false,
      volume: 0, displayOrder: 0, transitions: [],
        clips: [{ id: "a1", kind: "audio", src: "/bgm.mp3", in: 0, out: 4, trackOffset: 0,
                  volume: 1, fadeIn: 0, fadeOut: 0, type: "bgm",
                  ducking: { ratio: 4, attack: 200, release: 1000 } }] },
      { id: "audio-vo", kind: "audio", label: "VO", muted: false, hidden: false,
      volume: 0, displayOrder: 1, transitions: [],
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
      volume: 0, displayOrder: 0, transitions: [],
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

  // R46 — runEncodeStage now awaits pickEncoder() before spawning ffmpeg.
  // Tests need to flush one microtask so the spawn has happened before
  // we reach into _spawn.mock.results.
  const flushMicrotasks = async () => {
    await new Promise<void>((r) => setImmediate(r));
  };

  it("AC2 — builds an ffmpeg command with -c:v libx264 -b:v 8000k for the douyin preset", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    await flushMicrotasks();
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
    await flushMicrotasks();
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libx265");
  });

  it("maps codec names: vp9 → libvpx-vp9", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "vp9" });
    await flushMicrotasks();
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libvpx-vp9");
  });

  it("maps codec names: av1 → libaom-av1", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "av1" });
    await flushMicrotasks();
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libaom-av1");
  });

  it("rejects when ffmpeg exits non-zero, including stderr", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    await flushMicrotasks();
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

// PRD-0014 S18 finding C [high] — h264_videotoolbox is picky about certain
// resolution/bitrate combos ("Error setting bitrate property:-12900" at
// 1280x720 / 8Mbps in the recon E2E D3, while 1080x1920 succeeded). A hardware
// encoder failing must NEVER hang an export — the stage auto-falls-back to
// software libx264 once and logs a warning, so the deliverable always lands.
describe("runEncodeStage — hardware encoder fallback to software (S18 C)", () => {
  const flushMicrotasks = async () => {
    await new Promise<void>((r) => setImmediate(r));
  };
  beforeEach(async () => {
    _spawn.mockClear();
    // videotoolbox present AND the top h264 pick on this list → picked first.
    process.env.AUTOVIRAL_FAKE_ENCODERS = "h264_videotoolbox,libx264";
    const gpu = await import("./render/gpu-encoder.js");
    gpu._resetEncoderCacheForTests();
  });
  afterEach(async () => {
    process.env.AUTOVIRAL_FAKE_ENCODERS = "libx264,libx265,libvpx-vp9,libaom-av1";
    const gpu = await import("./render/gpu-encoder.js");
    gpu._resetEncoderCacheForTests();
  });

  it("retries with libx264 when h264_videotoolbox fails (-12900), then succeeds", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    await flushMicrotasks();
    // First spawn = the hardware encoder.
    expect(_spawn.mock.calls[0][1]).toContain("h264_videotoolbox");
    const first = _spawn.mock.results[0].value;
    first.stderr.emit("data", Buffer.from("Error setting bitrate property:-12900"));
    first.emit("close", 1);
    await flushMicrotasks();
    // Second spawn = software libx264 fallback.
    expect(_spawn).toHaveBeenCalledTimes(2);
    expect(_spawn.mock.calls[1][1]).toContain("libx264");
    expect(_spawn.mock.calls[1][1]).not.toContain("h264_videotoolbox");
    const second = _spawn.mock.results[1].value;
    second.emit("close", 0);
    await expect(promise).resolves.toBeUndefined();
  });

  it("does NOT double-encode when the hardware encoder succeeds", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    await flushMicrotasks();
    const first = _spawn.mock.results[0].value;
    first.emit("close", 0);
    await promise;
    expect(_spawn).toHaveBeenCalledTimes(1); // no needless fallback re-encode
  });

  it("surfaces the software error when the fallback ALSO fails (bounded, no infinite retry)", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    await flushMicrotasks();
    _spawn.mock.results[0].value.emit("close", 1); // videotoolbox fails
    await flushMicrotasks();
    const second = _spawn.mock.results[1].value;
    second.stderr.emit("data", Buffer.from("libx264 genuine failure"));
    second.emit("close", 3);
    await expect(promise).rejects.toThrow(/libx264 genuine failure/);
    expect(_spawn).toHaveBeenCalledTimes(2); // exactly one fallback, not a loop
  });

  it("does NOT fall back on an aborted encode (abort is not an encoder-picky failure)", async () => {
    const ac = new AbortController();
    _spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => proc.emit("close", 130);
      return proc;
    });
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin, ac.signal);
    setTimeout(() => ac.abort(), 0);
    await expect(promise).rejects.toThrow(/aborted/);
    expect(_spawn).toHaveBeenCalledTimes(1); // aborted → no software retry
  });
});

describe("runRenderPipeline — encode stage wiring", () => {
  it("invokes ffmpeg via spawn when comp.exportPresets[0] is present", async () => {
    _spawn.mockClear();
    const compWithPreset: Composition = { ...baseComp, exportPresets: [douyin] };
    const promise = runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out" });
    await drainSpawnsUntilSettled(_spawn, promise);
    await promise;
    expect(_spawn).toHaveBeenCalled();
    const encodeCall = _spawn.mock.calls.find((c) =>
      (c[1] as string[]).includes("libx264"),
    );
    expect(encodeCall, "expected an encode-stage spawn with libx264").toBeDefined();
  });

  it("falls back to rename passthrough when comp.exportPresets is empty", async () => {
    _spawn.mockClear();
    await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out" });
    // baseComp has exportPresets: [], so spawn must NOT be called.
    expect(_spawn).not.toHaveBeenCalled();
  });

  // S11 review finding 1 — `render enqueue --preset <id>` must actually REACH
  // the encoder, not be dropped in favour of exportPresets[0]. Give the comp
  // TWO presets and ask for the SECOND by id: the encode-stage ffmpeg must use
  // the requested preset's bitrate (12000k), NOT the first preset's (8000k).
  it("applies the queued opts.presetId (2nd preset), NOT exportPresets[0]", async () => {
    _spawn.mockClear();
    const bili: ExportPreset = {
      ...douyin,
      id: "bilibili-16-9",
      label: "B站 16:9",
      platform: "bilibili",
      videoBitrate: 12000,
    };
    const compTwoPresets: Composition = {
      ...baseComp,
      exportPresets: [douyin, bili],
    };
    const promise = runRenderPipeline({
      comp: compTwoPresets,
      outDir: "/tmp/out-preset",
      presetId: "bilibili-16-9",
    });
    await drainSpawnsUntilSettled(_spawn, promise);
    await promise;
    const encodeCall = _spawn.mock.calls.find((c) =>
      (c[1] as string[]).includes("libx264"),
    );
    expect(encodeCall, "expected an encode-stage spawn").toBeDefined();
    const args = encodeCall![1] as string[];
    // The requested preset (bilibili, 12000k) must win over exportPresets[0]
    // (douyin, 8000k).
    expect(args).toContain("12000k");
    expect(args).not.toContain("8000k");
  });

  it("throws a clear error when opts.presetId names a preset the comp does not have", async () => {
    _spawn.mockClear();
    const compWithPreset: Composition = { ...baseComp, exportPresets: [douyin] };
    await expect(
      runRenderPipeline({
        comp: compWithPreset,
        outDir: "/tmp/out-badpreset",
        presetId: "does-not-exist",
      }),
    ).rejects.toThrow(/preset/i);
  });
});

// S11 review finding 6 — a `--caption-tracks` request that names a text-track
// id the composition does NOT contain must FAIL LOUDLY (before the expensive
// render), not silently render as if the caption were produced. Pre-fix the id
// was silently filtered out and the job still reported success with no captions.
describe("runRenderPipeline — caption track validation (S11 finding 6)", () => {
  const compWithTextTrack: Composition = {
    ...baseComp,
    tracks: [
      {
        id: "t_zh",
        kind: "text",
        clips: [],
      } as any,
    ],
  };

  it("rejects a burnTrackId that references a non-existent text track", async () => {
    await expect(
      runRenderPipeline({
        comp: compWithTextTrack,
        outDir: "/tmp/out-badcap-1",
        captionTracks: { burnTrackId: "t_ghost" },
      }),
    ).rejects.toThrow(/t_ghost/);
  });

  it("rejects a sidecarTrackId that references a non-existent text track", async () => {
    await expect(
      runRenderPipeline({
        comp: compWithTextTrack,
        outDir: "/tmp/out-badcap-2",
        captionTracks: { burnTrackId: "t_zh", sidecarTrackIds: ["t_missing"] },
      }),
    ).rejects.toThrow(/t_missing/);
  });

  it("accepts caption tracks that all exist (no throw)", async () => {
    _spawn.mockClear();
    const promise = runRenderPipeline({
      comp: compWithTextTrack,
      outDir: "/tmp/out-goodcap",
      captionTracks: { burnTrackId: "t_zh", sidecarTrackIds: [] },
    });
    await drainSpawnsUntilSettled(_spawn, promise);
    await expect(promise).resolves.toMatch(/\.mp4$/);
  });
});

// S5 (issue #027) — a successful export must not litter output/ with the
// derived intermediate mp4s (Stage 1 raw render + -ducked/-burned/-normalized)
// the asset library then has to filter back out (S4). Cleanup is best-effort
// and only ever runs on the success path — any stage that rejects above
// leaves the whole crime scene on disk for diagnosis, by construction (the
// cleanup code sits after every stage has already resolved).
describe("runRenderPipeline — intermediate cleanup (S5 / issue #027)", () => {
  it("unlinks the Stage-1 output on a minimal rename-passthrough export, but NOT the intermediate rename() already consumed, nor the final path", async () => {
    const out = await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out-cleanup-1" });
    // Minimal pipeline = Stage 1 render + loudnorm (hasMeaningfulAudio probes
    // a nonexistent file → ENOENT → treated as "has audio", see the fn's
    // doc comment), then rename() straight to finalPath (no preset).
    // rename() already moved the pre-rename intermediate (…-normalized.mp4)
    // away, so only the Stage-1 raw output remains to be cleaned up.
    expect(_unlink).toHaveBeenCalledTimes(1);
    expect(_unlink).toHaveBeenCalledWith("/tmp/out-cleanup-1/render-intermediate.mp4");
    const unlinked = _unlink.mock.calls.map((c) => c[0]);
    expect(unlinked).not.toContain(out);
    expect(unlinked).not.toContain(
      "/tmp/out-cleanup-1/render-intermediate-normalized.mp4",
    );
  });

  it("unlinks BOTH the Stage-1 output and the pre-encode intermediate when a preset triggers ffmpeg re-encode (encode does not consume/delete its input)", async () => {
    _spawn.mockClear();
    const compWithPreset: Composition = { ...baseComp, exportPresets: [douyin] };
    const promise = runRenderPipeline({ comp: compWithPreset, outDir: "/tmp/out-cleanup-2" });
    await drainSpawnsUntilSettled(_spawn, promise);
    const out = await promise;
    const unlinked = _unlink.mock.calls.map((c) => c[0]);
    expect(unlinked).toContain("/tmp/out-cleanup-2/render-intermediate.mp4");
    expect(unlinked).toContain(
      "/tmp/out-cleanup-2/render-intermediate-normalized.mp4",
    );
    expect(unlinked).not.toContain(out);
  });

  it("performs zero cleanup when a stage rejects — the failure preserves every intermediate for diagnosis", async () => {
    const normMock = normalizeLufs as unknown as ReturnType<typeof vi.fn>;
    normMock.mockRejectedValueOnce(new Error("loudnorm boom"));
    await expect(
      runRenderPipeline({ comp: baseComp, outDir: "/tmp/out-cleanup-3" }),
    ).rejects.toThrow(/loudnorm boom/);
    expect(_unlink).not.toHaveBeenCalled();
  });

  it("swallows an unlink failure — best-effort cleanup never flips a successful export into a reported failure", async () => {
    _unlink.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await runRenderPipeline({ comp: baseComp, outDir: "/tmp/out-cleanup-4" });
    expect(out).toMatch(/^\/tmp\/out-cleanup-4\/final-\d+\.mp4$/);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// Phase 8.3.E — speed-ramp pre-pass tests. For each VideoClip with a static
// non-1 speed, the pipeline invokes ffmpeg with `setpts=PTS/<k>` + chained
// `atempo` BEFORE Remotion renders. Variable-speed clips emit a warning and
// are not pre-passed.
describe("runRenderPipeline — speed-ramp pre-pass (Phase 8.3.E)", () => {
  // Per-test alias over the settled-drain (see drainSpawnsUntilSettled above —
  // fixed-round draining was the chronic CI-timeout flake in this file).
  function drainSpawnsToClose(promise: Promise<unknown>): Promise<void> {
    return drainSpawnsUntilSettled(_spawn, promise);
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
          volume: 0,
          displayOrder: 0,
      transitions: [],
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
    await drainSpawnsToClose(promise);
    await promise;
    // First spawn call IS the speed pre-pass (Stage 0), before any other
    // ffmpeg-invoking stage.
    expect(_spawn).toHaveBeenCalled();
    // The first ffmpeg spawn IS the speed pre-pass (a preceding ffprobe now
    // detects the audio stream — S4 silent-video guard, finding 2).
    const firstCall = _spawn.mock.calls.find((c) => c[0] === "ffmpeg")!;
    const args = firstCall[1] as string[];
    const filterIdx = args.indexOf("-filter_complex");
    expect(filterIdx).toBeGreaterThan(-1);
    const filter = args[filterIdx + 1];
    expect(filter).toContain("setpts=PTS/2");
    expect(filter).toContain("atempo=2.0000");
    // Output filename should encode the clip id + speed + fps for caching
    // (fps joined the key in the S3×S6 review fix — PRD-0011 made fps
    // user-editable, so it must invalidate the cache too).
    const output = args[args.length - 1];
    expect(output).toContain("clip-1-speed-200-fps30.mp4");
  });

  it("static speed=0.5 invokes ffmpeg with setpts=PTS/0.5 and atempo=0.5", async () => {
    _spawn.mockClear();
    const comp = makeVideoCompWithSpeed("clip-1", 0.5);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-speed-0_5" });
    await drainSpawnsToClose(promise);
    await promise;
    const args = _spawn.mock.calls.find((c) => c[0] === "ffmpeg")![1] as string[];
    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1];
    expect(filter).toContain("setpts=PTS/0.5");
    expect(filter).toContain("atempo=0.5000");
    expect(args[args.length - 1]).toContain("clip-1-speed-50-fps30.mp4");
  });

  it("static speed=4.0 chains atempo=2.0,atempo=2.0", async () => {
    _spawn.mockClear();
    const comp = makeVideoCompWithSpeed("clip-1", 4.0);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-speed-4" });
    await drainSpawnsToClose(promise);
    await promise;
    const args = _spawn.mock.calls.find((c) => c[0] === "ffmpeg")![1] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("setpts=PTS/4");
    // chainAtempo(4) → "atempo=2.0000,atempo=2.0000"
    expect(filter).toContain("atempo=2.0000,atempo=2.0000");
  });

  // S4 (PRD-0014) — variable speed export used to warn + fall back to 1×. It
  // now runs a real segmented setpts/atempo → concat pre-pass, so the FIRST
  // spawn IS the speed pass, the filtergraph carries per-segment trim+setpts,
  // and NO "Variable-speed export" warning is emitted.
  it("variable speed → segmented setpts/atempo concat pre-pass spawned, no warn", async () => {
    _spawn.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Two distinct keyframe values → variable speed.
    const comp = makeVideoCompWithSpeed("clip-1", [
      { time: 0, value: 2.0 },
      { time: 2, value: 1.0 },
    ]);
    const promise = runRenderPipeline({ comp, outDir: "/tmp/out-var" });
    await drainSpawnsToClose(promise);
    await promise;
    // Stage 0 is the speed pass: its filter_complex builds per-segment
    // trim/setpts + a concat. (A preceding ffprobe now detects the audio
    // stream — find the ffmpeg call, not calls[0].)
    const firstCall = _spawn.mock.calls.find((c) => c[0] === "ffmpeg")!;
    const args = firstCall[1] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1] as string;
    // TIMELINE-domain eased plan (S4 finding 1): the 2→1 linear ramp over
    // timeline [0,2] consumes 3s of source → an AVERAGED 1.5× first segment
    // (the old source-domain hold-left plan emitted a literal 2× here).
    expect(filter).toContain("setpts=(PTS-STARTPTS)/1.5");
    expect(filter).toContain("concat=n=2:v=1:a=1[v][a]");
    const output = args[args.length - 1] as string;
    expect(output).toMatch(/clip-clip-1-speedvar-[0-9a-f]+\.mp4$/);
    // The dead v1 warning must be gone.
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/Variable-speed export/i),
    );
    warnSpy.mockRestore();
  });
});

// Phase G (issue #34) — per-track volume + mute fold into MixTrack adapter.
// These tests exercise compositionToMixTracks in isolation (no ffmpeg, no
// Remotion) so they're cheap and deterministic. The real-ffmpeg integration
// lives in src/server/__tests__/render-pipeline.mix-integration.test.ts.
describe("compositionToMixTracks — Phase G per-track volume + mute (issue #34)", () => {
  function audioLane(opts: {
    id: string;
    label: string;
    order: number;
    volumeDb?: number;
    muted?: boolean;
    clips: Array<{
      id: string;
      src: string;
      clipVolume?: number;
      type?: "bgm" | "voiceover" | "sfx" | "original";
      offset?: number;
      inSec?: number;
      duration?: number;
      ducking?: { ratio: number; attack: number; release: number };
    }>;
  }) {
    return {
      id: opts.id,
      kind: "audio" as const,
      label: opts.label,
      displayOrder: opts.order,
      muted: opts.muted ?? false,
      hidden: false,
      transitions: [],
      volume: opts.volumeDb ?? 0,
      clips: opts.clips.map((c) => ({
        id: c.id,
        kind: "audio" as const,
        src: c.src,
        in: c.inSec ?? 0,
        out: c.duration ?? 4,
        trackOffset: c.offset ?? 0,
        volume: c.clipVolume ?? 1,
        fadeIn: 0,
        fadeOut: 0,
        type: c.type ?? "bgm",
        ducking: c.ducking,
      })),
    };
  }

  it("folds lane volume (dB) into each clip's linear volume — 0 dB = unity, -6 dB ≈ 0.501, -12 dB ≈ 0.251", () => {
    const comp: Composition = {
      ...baseComp,
      tracks: [
        audioLane({ id: "trk_bgm", label: "BGM", order: 0, volumeDb: -6,
          clips: [{ id: "ac_bgm", src: "/bgm.mp3", clipVolume: 1, type: "bgm" }] }),
        audioLane({ id: "trk_vo", label: "VO", order: 1, volumeDb: 0,
          clips: [{ id: "ac_vo", src: "/vo.wav", clipVolume: 1, type: "voiceover" }] }),
        audioLane({ id: "trk_sfx", label: "SFX", order: 2, volumeDb: -12,
          clips: [{ id: "ac_sfx", src: "/sfx.wav", clipVolume: 0.8, type: "sfx" }] }),
      ],
    };
    const mix = __compositionToMixTracksForTest(comp);
    expect(mix).toHaveLength(3);
    const bgm = mix.find((m) => m.type === "bgm")!;
    const vo = mix.find((m) => m.type === "voiceover")!;
    const sfx = mix.find((m) => m.type === "sfx")!;
    // -6 dB → 10^(-6/20) ≈ 0.5012
    expect(bgm.volume).toBeCloseTo(0.5012, 3);
    // 0 dB → unity
    expect(vo.volume).toBeCloseTo(1.0, 6);
    // -12 dB × clipVolume 0.8 → 0.2512 × 0.8 ≈ 0.2009
    expect(sfx.volume).toBeCloseTo(0.2009, 3);
  });

  // S5 review fix #2 — a detached / trimmed AudioClip carries a non-zero source
  // in-point; the ducking re-mix must read the SAME [in,out] sub-region Stage-1
  // Remotion did, or it plays from source second 0. This asserts the adapter
  // forwards in/out (the mixAudioTracks side then emits atrim=start:end).
  it("carries the clip's source [in,out] into the MixTrack (detached/trimmed clip)", () => {
    const comp: Composition = {
      ...baseComp,
      tracks: [
        audioLane({
          id: "trk_orig",
          label: "Original",
          order: 0,
          clips: [
            {
              id: "ac_det",
              src: "/shot.mp4",
              type: "original",
              inSec: 5,
              duration: 10, // out
              offset: 2,
            },
          ],
        }),
      ],
    };
    const mix = __compositionToMixTracksForTest(comp);
    expect(mix).toHaveLength(1);
    expect(mix[0].in).toBe(5);
    expect(mix[0].out).toBe(10);
    expect(mix[0].delay).toBe(2); // trackOffset → adelay positions the trimmed seg
  });

  it("track.muted=true collapses lane gain to ~0 regardless of lane volume or clip volume", () => {
    const comp: Composition = {
      ...baseComp,
      tracks: [
        audioLane({ id: "trk_bgm", label: "BGM", order: 0,
          volumeDb: 0, muted: true,
          clips: [{ id: "ac_bgm", src: "/bgm.mp3", clipVolume: 1.5, type: "bgm" }] }),
      ],
    };
    const mix = __compositionToMixTracksForTest(comp);
    // 1e-6 sentinel × 1.5 = 1.5e-6 — audibly silent (~ -116 dBFS)
    expect(mix[0].volume).toBeLessThan(1e-5);
    expect(mix[0].volume).toBeGreaterThan(0); // strictly positive — ffmpeg-safe
  });

  it("reordering audio lanes does NOT change the set of MixTracks (mix is commutative)", () => {
    const a = audioLane({ id: "trk_bgm", label: "BGM", order: 0, volumeDb: -6,
      clips: [{ id: "ac_bgm", src: "/bgm.mp3", clipVolume: 1, type: "bgm" }] });
    const b = audioLane({ id: "trk_vo", label: "VO", order: 1, volumeDb: 0,
      clips: [{ id: "ac_vo", src: "/vo.wav", clipVolume: 1, type: "voiceover" }] });
    const c = audioLane({ id: "trk_sfx", label: "SFX", order: 2, volumeDb: -3,
      clips: [{ id: "ac_sfx", src: "/sfx.wav", clipVolume: 1, type: "sfx" }] });
    const forward: Composition = { ...baseComp, tracks: [a, b, c] };
    const reverse: Composition = { ...baseComp, tracks: [c, b, a] };
    const mixF = __compositionToMixTracksForTest(forward);
    const mixR = __compositionToMixTracksForTest(reverse);
    const key = (mt: { source: string; volume: number; type: string }) =>
      `${mt.source}|${mt.type}|${mt.volume.toFixed(6)}`;
    expect(mixF.map(key).sort()).toEqual(mixR.map(key).sort());
  });

  it("ducking routes by track type, not by lane index — works correctly with N=3 lanes", () => {
    const comp: Composition = {
      ...baseComp,
      tracks: [
        audioLane({ id: "trk_bgm", label: "BGM", order: 0, volumeDb: -6,
          clips: [{ id: "ac_bgm", src: "/bgm.mp3", type: "bgm",
            ducking: { ratio: 4, attack: 200, release: 1000 } }] }),
        audioLane({ id: "trk_vo", label: "VO", order: 1, volumeDb: 0,
          clips: [{ id: "ac_vo", src: "/vo.wav", type: "voiceover" }] }),
        audioLane({ id: "trk_sfx", label: "SFX", order: 2, volumeDb: -3,
          clips: [{ id: "ac_sfx", src: "/sfx.wav", type: "sfx",
            ducking: { ratio: 6, attack: 100, release: 500 } }] }),
      ],
    };
    const mix = __compositionToMixTracksForTest(comp);
    const bgm = mix.find((m) => m.type === "bgm")!;
    const sfx = mix.find((m) => m.type === "sfx")!;
    const vo = mix.find((m) => m.type === "voiceover")!;
    expect(bgm.ducking).toEqual({ trigger: "voiceover", ratio: 4 });
    expect(sfx.ducking).toEqual({ trigger: "voiceover", ratio: 6 });
    expect(vo.ducking).toBeUndefined(); // voiceover never ducks itself
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
    // Multi-tick drain: the loudnorm-stage audio probe adds an await before
    // the encode spawn, so a single setImmediate isn't enough.
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      for (const r of _spawn.mock.results) {
        const proc = r.value;
        if (!proc._closed) { proc._closed = true; proc.emit("close", 0); }
      }
    }
    await promise;
    const encodeCall = _spawn.mock.calls.find((c) =>
      (c[1] as string[]).includes("-b:v"),
    );
    expect(encodeCall, "expected an encode-stage spawn with -b:v").toBeDefined();
    const args = encodeCall![1] as string[];
    const bvIdx = args.indexOf("-b:v");
    expect(args[bvIdx + 1]).toBe("4000k"); // halved from 8000
    const baIdx = args.indexOf("-b:a");
    expect(args[baIdx + 1]).toBe("192k");  // kept
  });
});
