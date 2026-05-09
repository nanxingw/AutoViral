import { describe, it, expect } from "vitest";
import { buildLightLeakFilterGraph } from "./transitions.js";

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
