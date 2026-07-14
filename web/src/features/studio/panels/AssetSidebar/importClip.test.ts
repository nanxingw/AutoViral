import { describe, it, expect, beforeEach, vi } from "vitest";
import { importClipRemote } from "./importClip";

// S6b (PRD-0014) — the video "add to timeline" path converges on the SAME
// server-side `importClip` verb the agent's `autoviral clip import` CLI runs
// (bridge POST /import → ffprobe → Asset/Provenance registration). This unit
// locks the transport shape; mock apiFetch and assert path/headers/body.
const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

describe("importClipRemote (S6b — bridge /import transport)", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({
      ok: true,
      result: { clipId: "vc_1", assetId: "imp_1", durationSec: 4.2 },
    });
  });

  it("POSTs /import with the work-id header and ONLY the work-relative path", async () => {
    const res = await importClipRemote("w1", { path: "output/final.mp4" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: Record<string, unknown> },
    ];
    // Same route the agent's `autoviral clip import <path>` CLI hits.
    expect(path).toBe("/api/bridge/v1/import");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    // The server ffprobe is the sole duration source — the body carries NO
    // client-side placeholder duration.
    expect(opts.body).toEqual({ path: "output/final.mp4" });
    // The server echoes the probe result; we unwrap `result`.
    expect(res).toEqual({ clipId: "vc_1", assetId: "imp_1", durationSec: 4.2 });
  });

  it("forwards an explicit drop track + offset as trackId + `at` (the route's field name)", async () => {
    await importClipRemote("w1", {
      path: "output/final.mp4",
      trackId: "t_v1",
      atSec: 3.5,
    });
    const [, opts] = apiFetch.mock.calls[0] as [string, { body?: Record<string, unknown> }];
    expect(opts.body).toEqual({ path: "output/final.mp4", trackId: "t_v1", at: 3.5 });
  });

  it("forwards replaceTimeline + name when set", async () => {
    await importClipRemote("w1", {
      path: "output/final.mp4",
      replaceTimeline: true,
      name: "Final cut",
    });
    const [, opts] = apiFetch.mock.calls[0] as [string, { body?: Record<string, unknown> }];
    expect(opts.body).toEqual({
      path: "output/final.mp4",
      replaceTimeline: true,
      name: "Final cut",
    });
  });

  it("propagates a bridge failure (probe failed) to the caller — never swallows", async () => {
    apiFetch.mockRejectedValue(new Error("probe failed"));
    await expect(importClipRemote("w1", { path: "output/bad.mp4" })).rejects.toThrow(
      "probe failed",
    );
  });
});
