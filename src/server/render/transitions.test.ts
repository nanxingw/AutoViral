import { describe, it, expect } from "vitest";
import {
  buildLightLeakFilterGraph,
  buildGlitchCutFilterGraph,
  buildDomainWarpFilterGraph,
  buildGravLensFilterGraph,
} from "./transitions.js";

// We don't spawn ffmpeg in unit tests — the filter-graph builder is a
// pure function so we can assert on its output string. Integration with
// real ffmpeg happens in render-pipeline.test.ts (mocked spawn).

describe("buildLightLeakFilterGraph", () => {
  it("includes xfade with the right offset (clipA duration - transitionDuration)", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    // Transition starts at offset = 5 - 1 = 4.
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("light-leak overlay is gated by enable='between(t,offset,offset+duration)'", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 4,
      transitionDuration: 0.8,
      fps: 30,
    });
    expect(g).toContain("enable='between(t,3.2,4)'");
  });

  it("audio crossfades with same duration as video transition", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1.5,
      fps: 30,
    });
    expect(g).toContain("[0:a][1:a]acrossfade=d=1.5[a]");
  });

  it("overlay is brought up to target fps in RGBA so blend reads alpha", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 60,
    });
    expect(g).toContain("format=rgba,fps=60");
  });

  it("graph is a single-line semicolon-joined filter chain (ffmpeg requirement)", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    // No newlines (would break -filter_complex).
    expect(g).not.toContain("\n");
    // Has the expected number of filter steps (4: xfade, format, overlay, acrossfade).
    const steps = g.split(";");
    expect(steps).toHaveLength(4);
  });

  it("output stream labels are stable: video=[v], audio=[a]", () => {
    const g = buildLightLeakFilterGraph({
      clipADuration: 3,
      transitionDuration: 0.5,
      fps: 30,
    });
    // Final video step ends with [v] (the -map [v] target).
    expect(g).toContain("format=auto[v]");
    expect(g).toContain("acrossfade=d=0.5[a]");
  });
});

describe("buildGlitchCutFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("audio crossfades across the same window as the video transition", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 6,
      transitionDuration: 0.75,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=0.75");
  });

  it("uses geq for per-channel RGB jitter and is single-line", () => {
    const g = buildGlitchCutFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).not.toContain("\n");
    expect(g).toContain("geq=");
    // R/B channels get equal-and-opposite jitter; G untouched.
    expect(g).toContain("sin(t*200)*15");
    expect(g).toContain("-sin(t*200)*15");
  });
});

describe("buildDomainWarpFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 4,
      transitionDuration: 1.5,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1.5:offset=2.5");
  });

  it("audio crossfades with same duration", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 5,
      transitionDuration: 0.6,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=0.6");
  });

  it("warps via sinusoidal X offset that ramps with progress", () => {
    const g = buildDomainWarpFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 60,
    });
    expect(g).not.toContain("\n");
    expect(g).toContain("sin(Y/30+t*8)*40");
    // Ramp factor (t-offset)/duration must reference the offset (4) and duration (1).
    expect(g).toContain("(t-4)/1");
  });
});

describe("buildGravLensFilterGraph", () => {
  it("includes xfade=transition=fade with offset=clipADuration-transitionDuration", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).toContain("xfade=transition=fade:duration=1:offset=4");
  });

  it("audio crossfades with same duration", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 7,
      transitionDuration: 1.2,
      fps: 30,
    });
    expect(g).toContain("acrossfade=d=1.2");
  });

  it("applies lenscorrection to both A and B with time-animated k1", () => {
    const g = buildGravLensFilterGraph({
      clipADuration: 5,
      transitionDuration: 1,
      fps: 30,
    });
    expect(g).not.toContain("\n");
    expect(g).toContain("[0:v]lenscorrection=k1=");
    expect(g).toContain("[1:v]lenscorrection=k1=");
    expect(g).toContain("-0.5");
    expect(g).toContain("0.5");
  });
});
