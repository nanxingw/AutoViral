import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySpeedRampPrePass,
  speedRampCacheName,
  variableSpeedCacheName,
} from "./speed-ramp-ffmpeg.js";
import { makeEmptyComposition, type Composition } from "../shared/composition.js";

// PRD-0014 S5 review fix #4 — the speed-ramp pre-pass bakes a VIDEO-ONLY vs an
// AUDIO-CARRYING cache MP4 depending on resolveSourceAudio(clip).enabled. That
// value MUST be part of the cache key, or a disable→enable (or detach→undo)
// re-export hits a stale no-audio cache and stays silent. This drives the REAL
// applySpeedRampPrePass path (not the filter builder in isolation): pre-seed both
// variants' caches so each run HITS without invoking ffmpeg, and assert the two
// source-audio states resolve to DIFFERENT cache files.

function compWith(enabled: boolean): Composition {
  const comp = makeEmptyComposition({ workId: "w-cache" });
  comp.fps = 30;
  const vt = comp.tracks.find((t) => t.kind === "video")!;
  (vt.clips as unknown[]).push({
    id: "vcCache",
    kind: "video",
    src: "source.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    // static speed 2 → the static setpts/atempo branch of processVideoSpeed.
    keyframes: [{ property: "speed", time: 0, value: 2, easing: "linear" }],
    sourceAudio: { enabled },
  });
  return comp;
}

function firstVideoSrc(comp: Composition): string {
  return (comp.tracks.flatMap((t) => t.clips) as { kind: string; src: string }[]).find(
    (c) => c.kind === "video",
  )!.src;
}

describe("speed-ramp source-audio cache key (S5 review fix #4)", () => {
  it("speedRampCacheName folds source-audio state into the key (enabled default = legacy name)", () => {
    expect(speedRampCacheName("c", 2, 30, true)).not.toBe(
      speedRampCacheName("c", 2, 30, false),
    );
    // enabled default preserves the byte-for-byte legacy name (existing on-disk
    // enabled caches keep hitting after this change).
    expect(speedRampCacheName("c", 2, 30, true)).toBe(speedRampCacheName("c", 2, 30));
    expect(speedRampCacheName("c", 2, 30, false)).toMatch(/-na\.mp4$/);
  });

  it("variableSpeedCacheName folds source-audio state into the key", () => {
    const kfs = [
      { property: "speed" as const, time: 0, value: 2, easing: "linear" as const },
      { property: "speed" as const, time: 2, value: 0.5, easing: "linear" as const },
    ];
    expect(variableSpeedCacheName("c", kfs, 0, 4, 30, true)).not.toBe(
      variableSpeedCacheName("c", kfs, 0, 4, 30, false),
    );
    expect(variableSpeedCacheName("c", kfs, 0, 4, 30, true)).toBe(
      variableSpeedCacheName("c", kfs, 0, 4, 30),
    );
  });

  it("real prepass: disabled then enabled re-export resolve to DIFFERENT cache files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-cache-"));
    try {
      const probe = async () => true;

      // disabled variant — pre-seed ITS cache so the prepass HITS (no ffmpeg).
      const disabledName = speedRampCacheName("vcCache", 2, 30, false);
      writeFileSync(join(dir, disabledName), "DISABLED");
      const outD = await applySpeedRampPrePass(compWith(false), dir, undefined, probe);
      const srcD = firstVideoSrc(outD);
      expect(srcD).toBe(join(dir, disabledName));

      // enabled variant — pre-seed ITS cache too.
      const enabledName = speedRampCacheName("vcCache", 2, 30, true);
      writeFileSync(join(dir, enabledName), "ENABLED");
      const outE = await applySpeedRampPrePass(compWith(true), dir, undefined, probe);
      const srcE = firstVideoSrc(outE);
      expect(srcE).toBe(join(dir, enabledName));

      // The crux: the enabled re-export did NOT get served the disabled
      // (video-only, silent) cache — the bug this fix closes.
      expect(srcE).not.toBe(srcD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
