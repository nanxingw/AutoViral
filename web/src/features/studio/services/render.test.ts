import { describe, it, expect } from "vitest";
import { resolveRenderOpts, type EnqueueRenderOptions } from "./render";

// #80 — the platform preset's loudnessTargetLufs (stored in
// comp.exportPresets[0]) was never forwarded into the render request, so the
// server's loudnorm always fell back to -14. WeChat Channels (-16) and any
// future non-default target were silently dropped. resolveRenderOpts is the
// explicit bridge; these tests pin the merge contract.

const baseOpts: EnqueueRenderOptions = { type: "full" };

describe("resolveRenderOpts (#80)", () => {
  it("forwards a non-default preset loudness target into the render opts", () => {
    const merged = resolveRenderOpts(baseOpts, {
      id: "weixin-channels",
      loudnessTargetLufs: -16,
    });
    expect(merged.loudnessTargetLufs).toBe(-16);
    expect(merged.presetId).toBe("weixin-channels");
    expect(merged.type).toBe("full");
  });

  it("forwards the -14 presets too (explicit, same result as the server default)", () => {
    const merged = resolveRenderOpts(baseOpts, {
      id: "xiaohongshu",
      loudnessTargetLufs: -14,
    });
    expect(merged.loudnessTargetLufs).toBe(-14);
    expect(merged.presetId).toBe("xiaohongshu");
  });

  it("leaves loudness undefined when there is no preset (server keeps its -14 default)", () => {
    const merged = resolveRenderOpts(baseOpts, undefined);
    expect(merged.loudnessTargetLufs).toBeUndefined();
    expect(merged.presetId).toBeUndefined();
    // No regression: the opts are otherwise untouched.
    expect(merged).toMatchObject({ type: "full" });
  });

  it("an explicit value on opts wins over the preset (future override path)", () => {
    const merged = resolveRenderOpts(
      { type: "full", loudnessTargetLufs: -23, presetId: "custom" },
      { id: "weixin-channels", loudnessTargetLufs: -16 },
    );
    expect(merged.loudnessTargetLufs).toBe(-23);
    expect(merged.presetId).toBe("custom");
  });

  it("preserves unrelated opts fields (captionTracks, type)", () => {
    const opts: EnqueueRenderOptions = {
      type: "proxy",
      captionTracks: { burnTrackId: "trk_x", sidecarTrackIds: ["trk_y"] },
    };
    const merged = resolveRenderOpts(opts, {
      id: "weixin-channels",
      loudnessTargetLufs: -16,
    });
    expect(merged.type).toBe("proxy");
    expect(merged.captionTracks).toEqual({
      burnTrackId: "trk_x",
      sidecarTrackIds: ["trk_y"],
    });
    expect(merged.loudnessTargetLufs).toBe(-16);
  });

  it("handles a preset missing loudnessTargetLufs (only id carried through)", () => {
    const merged = resolveRenderOpts(baseOpts, { id: "custom" });
    expect(merged.presetId).toBe("custom");
    expect(merged.loudnessTargetLufs).toBeUndefined();
  });
});
