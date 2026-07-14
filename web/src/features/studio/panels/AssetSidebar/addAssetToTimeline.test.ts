import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  buildClipFromAsset,
  isAddableAsset,
  useAddAssetToTimeline,
  DEFAULT_ASSET_CLIP_DUR,
} from "./addAssetToTimeline";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import { useToastStore } from "@/stores/toast";
import { ApiError } from "@/lib/api";
import type { AssetItem } from "@/queries/assets";

// S6b (PRD-0014) — placing a VIDEO library asset onto the timeline no longer
// builds a local fixed-5s placeholder clip. It goes through the shared
// server-side `importClip` verb (bridge POST /import → ffprobe → Asset/Provenance
// registration), the SAME verb `autoviral clip import` runs — so the duration
// comes from a real probe and the asset/provenance graph is registered.
// audio/image stay on the local store path (importClip is video-only).
const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

function asset(over: Partial<AssetItem> = {}): AssetItem {
  return {
    path: "assets/clips/a.mp4",
    url: "/api/works/w1/assets/clips/a.mp4",
    kind: "video",
    ext: "mp4",
    name: "a.mp4",
    ...over,
  };
}

describe("buildClipFromAsset (S6b — video no longer builds locally)", () => {
  it("video → null: the server importClip owns video placement now", () => {
    expect(
      buildClipFromAsset(asset({ kind: "video", path: "assets/clips/x.mp4" }), 2),
    ).toBeNull();
  });

  it("audio → an audio clip (bgm, unity volume) at the default length", () => {
    const clip = buildClipFromAsset(asset({ kind: "audio", path: "assets/audio/b.mp3" }), 0)!;
    expect(clip.kind).toBe("audio");
    expect((clip as { type: string }).type).toBe("bgm");
    expect((clip as { volume: number }).volume).toBe(1);
    expect((clip as { out: number }).out).toBe(DEFAULT_ASSET_CLIP_DUR);
  });

  it("image → a full-frame overlay clip", () => {
    const clip = buildClipFromAsset(asset({ kind: "image", path: "assets/img/c.png" }), 0)!;
    expect(clip.kind).toBe("overlay");
    expect((clip as { position: unknown }).position).toEqual({
      xPct: 0,
      yPct: 0,
      wPct: 100,
      hPct: 100,
    });
    expect((clip as { duration: number }).duration).toBe(DEFAULT_ASSET_CLIP_DUR);
  });

  it("text / other → null (no timeline representation)", () => {
    expect(buildClipFromAsset(asset({ kind: "text" }), 0)).toBeNull();
    expect(buildClipFromAsset(asset({ kind: "other" }), 0)).toBeNull();
    expect(isAddableAsset(asset({ kind: "text" }))).toBe(false);
    expect(isAddableAsset(asset({ kind: "video" }))).toBe(true);
  });
});

describe("useAddAssetToTimeline — video path (S6b)", () => {
  beforeEach(() => {
    useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
    useComposition.setState({ selection: null });
    useToastStore.getState().clear();
    apiFetch.mockReset();
  });

  function videoTrack() {
    return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
  }

  it("POSTs the bridge /import verb (server ffprobe owns duration) instead of a local 5s clip", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      result: { clipId: "vc_x", assetId: "imp_y", durationSec: 8.3 },
    });
    const { result } = renderHook(() => useAddAssetToTimeline());
    const res = await result.current(asset({ kind: "video", path: "output/final.mp4" }));

    // Request went to the shared server verb, carrying the work id + the
    // work-relative path — NO client-side placeholder duration in the body.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: Record<string, unknown> },
    ];
    expect(path).toBe("/api/bridge/v1/import");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    expect(opts.body).toEqual({ path: "output/final.mp4" });

    // Duration is the probe value (8.3), never the fixed 5s placeholder.
    expect(res).toMatchObject({ status: "added", clipId: "vc_x", durationSec: 8.3 });
    expect((res as { durationSec?: number }).durationSec).not.toBe(DEFAULT_ASSET_CLIP_DUR);

    // No local clip is placed — the WS composition-changed broadcast brings the
    // imported clip in (server ffprobe is the sole duration source).
    expect(videoTrack().clips).toHaveLength(0);
  });

  it("probe failure surfaces a user-visible error toast and places NO clip", async () => {
    apiFetch.mockRejectedValue(
      new ApiError("400 Bad Request", 400, {
        ok: false,
        error: "probe failed",
        errorCode: "PROBE_FAILED",
      }),
    );
    const { result } = renderHook(() => useAddAssetToTimeline());
    const res = await result.current(asset({ kind: "video", path: "output/bad.mp4" }));

    expect(res.status).toBe("error");
    expect(videoTrack().clips).toHaveLength(0);
    // User-visible error state (i18n) — not a silent no-op.
    const toasts = useToastStore.getState().entries;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("error");
  });
});

describe("useAddAssetToTimeline — audio/image regression (S6b: path unchanged)", () => {
  beforeEach(() => {
    useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
    useComposition.setState({ selection: null });
    apiFetch.mockReset();
  });

  function videoTrack() {
    return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
  }

  it("appends an audio asset locally (no bridge import) at the default length + selects it", async () => {
    const { result } = renderHook(() => useAddAssetToTimeline());
    const res = await result.current(
      asset({ kind: "audio", path: "assets/audio/b.mp3", ext: "mp3" }),
    );
    expect(apiFetch).not.toHaveBeenCalled();
    expect(res.status).toBe("added");
    const audio = useComposition.getState().comp!.tracks.find((t) => t.kind === "audio")!;
    expect(audio.clips).toHaveLength(1);
    expect((audio.clips[0] as { src: string }).src).toBe("assets/audio/b.mp3");
    expect((audio.clips[0] as { out: number }).out).toBe(DEFAULT_ASSET_CLIP_DUR);
    expect(useComposition.getState().selection).toBe(res.status === "added" ? res.clipId : null);
  });

  it("creates an overlay track on demand for an image (no bridge import)", async () => {
    expect(
      useComposition.getState().comp!.tracks.some((t) => t.kind === "overlay"),
    ).toBe(false);
    const { result } = renderHook(() => useAddAssetToTimeline());
    const res = await result.current(
      asset({ kind: "image", path: "assets/img/c.png", ext: "png" }),
    );
    expect(apiFetch).not.toHaveBeenCalled();
    expect(res.status).toBe("added");
    const overlay = useComposition
      .getState()
      .comp!.tracks.find((t) => t.kind === "overlay");
    expect(overlay).toBeDefined();
    expect(overlay!.clips).toHaveLength(1);
    expect(overlay!.clips[0].kind).toBe("overlay");
  });

  it("a non-placeable asset is a skipped no-op (no clip, no request)", async () => {
    const before = JSON.stringify(useComposition.getState().comp!.tracks);
    const { result } = renderHook(() => useAddAssetToTimeline());
    const res = await result.current(
      asset({ kind: "text", path: "assets/sub.srt", ext: "srt" }),
    );
    expect(res.status).toBe("skipped");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(useComposition.getState().comp!.tracks)).toBe(before);
    void videoTrack; // keep helper referenced without asserting on it here
  });
});
