import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  pickEncoder,
  detectAvailableEncoders,
  _resetEncoderCacheForTests,
} from "./gpu-encoder.js";

// Use the AUTOVIRAL_FAKE_ENCODERS env var to inject deterministic encoder
// availability without spawning ffmpeg. This is the same backdoor the
// runtime detection respects — our prod code path stays identical.

describe("pickEncoder — tier selection", () => {
  beforeEach(() => {
    _resetEncoderCacheForTests();
  });
  afterEach(() => {
    _resetEncoderCacheForTests();
    vi.unstubAllEnvs();
  });

  it("picks NVENC when available (highest priority)", async () => {
    vi.stubEnv(
      "AUTOVIRAL_FAKE_ENCODERS",
      "libx264,h264_videotoolbox,h264_nvenc,h264_qsv",
    );
    const choice = await pickEncoder("h264", "medium");
    expect(choice.tier).toBe("nvenc");
    expect(choice.codec).toBe("h264_nvenc");
    // medium → p4 in NVENC vocabulary
    expect(choice.presetArgs).toEqual(["-preset", "p4"]);
  });

  it("picks VideoToolbox on macOS-only encoder list", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "libx264,h264_videotoolbox");
    const choice = await pickEncoder("h264", "medium");
    expect(choice.tier).toBe("videotoolbox");
    expect(choice.codec).toBe("h264_videotoolbox");
    expect(choice.extraArgs).toContain("-allow_sw");
  });

  it("falls back to libx264 software when no hw encoder is available", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "libx264,libx265,libvpx-vp9");
    const choice = await pickEncoder("h264", "medium");
    expect(choice.tier).toBe("software");
    expect(choice.codec).toBe("libx264");
    expect(choice.presetArgs).toEqual(["-preset", "medium"]);
  });

  it("respects priority: NVENC > VideoToolbox even if both present", async () => {
    // Cross-platform server with VideoToolbox AND NVIDIA — pick NVENC.
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_videotoolbox,h264_nvenc");
    const choice = await pickEncoder("h264", "fast");
    expect(choice.tier).toBe("nvenc");
  });
});

describe("pickEncoder — preset translation", () => {
  beforeEach(() => {
    _resetEncoderCacheForTests();
  });
  afterEach(() => {
    _resetEncoderCacheForTests();
    vi.unstubAllEnvs();
  });

  it("translates libx264 'medium' → NVENC 'p4'", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_nvenc");
    const choice = await pickEncoder("h264", "medium");
    expect(choice.presetArgs).toEqual(["-preset", "p4"]);
  });

  it("translates 'ultrafast' → NVENC 'p1' (fastest)", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_nvenc");
    const choice = await pickEncoder("h264", "ultrafast");
    expect(choice.presetArgs).toEqual(["-preset", "p1"]);
  });

  it("translates 'veryslow' → NVENC 'p7' (slowest, highest q)", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_nvenc");
    const choice = await pickEncoder("h264", "veryslow");
    expect(choice.presetArgs).toEqual(["-preset", "p7"]);
  });

  it("VideoToolbox: realtime flag for ultrafast/veryfast presets", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_videotoolbox");
    const fast = await pickEncoder("h264", "ultrafast");
    expect(fast.presetArgs).toEqual(["-realtime", "1"]);
  });

  it("VideoToolbox: no preset for 'medium' (use VT defaults)", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_videotoolbox");
    const med = await pickEncoder("h264", "medium");
    expect(med.presetArgs).toEqual([]);
  });
});

describe("pickEncoder — h265 / hevc", () => {
  beforeEach(() => {
    _resetEncoderCacheForTests();
  });
  afterEach(() => {
    _resetEncoderCacheForTests();
    vi.unstubAllEnvs();
  });

  it("picks hevc_videotoolbox over libx265 on macOS", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "libx265,hevc_videotoolbox");
    const choice = await pickEncoder("h265", "medium");
    expect(choice.codec).toBe("hevc_videotoolbox");
    expect(choice.tier).toBe("videotoolbox");
  });

  it("falls back to libx265 if no hw hevc available", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "libx265");
    const choice = await pickEncoder("h265", "medium");
    expect(choice.codec).toBe("libx265");
    expect(choice.tier).toBe("software");
  });
});

describe("detectAvailableEncoders — caching", () => {
  beforeEach(() => {
    _resetEncoderCacheForTests();
  });
  afterEach(() => {
    _resetEncoderCacheForTests();
    vi.unstubAllEnvs();
  });

  it("caches result across calls (env var read once)", async () => {
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "h264_nvenc");
    const first = await detectAvailableEncoders();
    expect(first.has("h264_nvenc")).toBe(true);

    // Change the env var — cached call should NOT see it.
    vi.stubEnv("AUTOVIRAL_FAKE_ENCODERS", "libx264");
    const second = await detectAvailableEncoders();
    expect(second.has("h264_nvenc")).toBe(true); // still cached
    expect(second.has("libx264")).toBe(false);
  });
});
