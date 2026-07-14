// PRD-0014 S11 — `render snapshot --frame N` frame resolution.
//
// The pre-existing `snapshot [--at <time>]` derives the still's frame from a
// TIME (seconds → frame = round(sec * fps)) or the live playhead. `render
// snapshot --frame N` gives the agent a DIRECT 0-based frame index — the cheap
// ground-truth self-check point (a specific render frame, not a wall-clock
// time). `resolveSnapshotFrame` is the pure seam that picks between an explicit
// frame index (wins) and the legacy at/playhead time path, so the precedence is
// unit-testable without launching Chromium.

import { describe, it, expect } from "vitest";
import { resolveSnapshotFrame } from "./snapshot.js";

describe("resolveSnapshotFrame", () => {
  it("uses an explicit frame index verbatim (wins over at/playhead)", () => {
    expect(
      resolveSnapshotFrame({ frame: 30, at: 5, playheadSec: 2, fps: 30 }),
    ).toBe(30);
  });

  it("rounds a fractional explicit frame to the nearest integer", () => {
    expect(resolveSnapshotFrame({ frame: 12.4, fps: 30 })).toBe(12);
    expect(resolveSnapshotFrame({ frame: 12.6, fps: 30 })).toBe(13);
  });

  it("clamps a negative explicit frame to 0", () => {
    expect(resolveSnapshotFrame({ frame: -5, fps: 30 })).toBe(0);
  });

  it("ignores a non-finite explicit frame and falls back to the time path", () => {
    // NaN frame → derive from `at` (2s * 30fps = 60).
    expect(resolveSnapshotFrame({ frame: NaN, at: 2, fps: 30 })).toBe(60);
  });

  it("with no frame, derives from `at` seconds (round(sec*fps))", () => {
    // 1.234s at 30fps → 37.02 → 37.
    expect(resolveSnapshotFrame({ at: 1.234, fps: 30 })).toBe(37);
  });

  it("with no frame and no at, derives from the live playhead", () => {
    expect(resolveSnapshotFrame({ playheadSec: 3, fps: 24 })).toBe(72);
  });

  it("with neither frame/at/playhead, lands on frame 0", () => {
    expect(resolveSnapshotFrame({ fps: 30 })).toBe(0);
  });

  it("`at` wins over playhead when both present (explicit override of live state)", () => {
    expect(resolveSnapshotFrame({ at: 1, playheadSec: 9, fps: 30 })).toBe(30);
  });

  it("clamps a negative derived time to frame 0", () => {
    expect(resolveSnapshotFrame({ at: -3, fps: 30 })).toBe(0);
  });
});
