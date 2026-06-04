import { describe, it, expect } from "vitest";
import { resolveAssetUrl, resolveCompositionAssets } from "../resolveAssetUrl";
import type { Composition } from "../../types";

describe("resolveAssetUrl", () => {
  it("rewrites a relative assets/ path to /api/works/:id/assets/...", () => {
    expect(resolveAssetUrl("assets/videos/test.mp4", "w_1")).toBe(
      "/api/works/w_1/assets/videos/test.mp4",
    );
  });

  it("strips only the leading 'assets/' prefix once", () => {
    expect(resolveAssetUrl("assets/audio/clip.wav", "w_1")).toBe(
      "/api/works/w_1/assets/audio/clip.wav",
    );
  });

  it("treats paths without an 'assets/' prefix as raw subpaths", () => {
    expect(resolveAssetUrl("foo/bar.png", "w_1")).toBe(
      "/api/works/w_1/assets/foo/bar.png",
    );
  });

  it("encodes spaces and unicode segments", () => {
    expect(resolveAssetUrl("assets/视频/小 视频.mp4", "w_1")).toBe(
      `/api/works/w_1/assets/${encodeURIComponent("视频")}/${encodeURIComponent("小 视频.mp4")}`,
    );
  });

  it("passes http(s):// URLs through unchanged", () => {
    expect(resolveAssetUrl("https://cdn.example.com/x.mp4", "w_1")).toBe(
      "https://cdn.example.com/x.mp4",
    );
  });

  it("passes data: URLs through unchanged", () => {
    const u = "data:image/png;base64,iVBOR";
    expect(resolveAssetUrl(u, "w_1")).toBe(u);
  });

  it("passes blob: URLs through unchanged", () => {
    const u = "blob:http://localhost/abc";
    expect(resolveAssetUrl(u, "w_1")).toBe(u);
  });

  it("returns the input unchanged for empty string", () => {
    expect(resolveAssetUrl("", "w_1")).toBe("");
  });

  // Regression lock: server-side render pipelines have rewritten clip.src to
  // absolute /api/... paths and persisted them into composition.yaml. Without
  // a guard the function double-wraps into /api/works/<id>/assets//api/...
  // and the video element silently 404s while throwing MediaPlaybackError.
  // (Reported 2026-05-08 against w_20260407_1550_49d's output/final.mp4)
  it("passes /api/-prefixed page-absolute paths through unchanged", () => {
    const u = "/api/works/w_1/assets/output/final.mp4";
    expect(resolveAssetUrl(u, "w_1")).toBe(u);
  });

  it("passes any /-prefixed absolute path through unchanged", () => {
    expect(resolveAssetUrl("/static/foo.mp4", "w_1")).toBe("/static/foo.mp4");
  });

  // R47-fix3: dive graph thumbnails were broken because shared-asset
  // entries in composition.yaml carry an absolute filesystem path
  // (~/.autoviral/shared-assets/<cat>/<file>). Translate those to the
  // /api/shared-assets endpoint so <img src> can actually fetch them.
  it("translates absolute shared-asset filesystem paths to /api/shared-assets/*", () => {
    expect(
      resolveAssetUrl("/Users/me/.autoviral/shared-assets/characters/model-ref.png", "w_1"),
    ).toBe("/api/shared-assets/characters/model-ref.png");
  });

  it("matches shared-assets even with a custom data dir", () => {
    expect(
      resolveAssetUrl("/var/data/autoviral/shared-assets/scenes/sunset.png", "w_1"),
    ).toBe("/api/shared-assets/scenes/sunset.png");
  });

  it("encodes shared-asset category and filename", () => {
    expect(
      resolveAssetUrl("/Users/me/.autoviral/shared-assets/characters/Korean girl.png", "w_1"),
    ).toBe(`/api/shared-assets/characters/${encodeURIComponent("Korean girl.png")}`);
  });
});

describe("resolveCompositionAssets", () => {
  const baseComp = (): Composition => ({
    id: "c1",
    workId: "w_1",
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 3,
    aspect: "9:16",
    tracks: [],
    updatedAt: "2026-05-07T00:00:00Z",
    assets: [],
    provenance: [],
    exportPresets: [],
  });

  it("rewrites video/audio/overlay clip srcs and leaves text clips intact", () => {
    const comp: Composition = {
      ...baseComp(),
      tracks: [
        {
          id: "tv", kind: "video", label: "V", displayOrder: 0, volume: 0, transitions: [], muted: false, hidden: false,
          clips: [{ id: "c1", kind: "video", src: "assets/videos/a.mp4", in: 0, out: 3, trackOffset: 0, fitMode: "cover", transforms: {} as any, filters: {} as any }],
        },
        {
          id: "ta", kind: "audio", label: "A", displayOrder: 1, volume: 0, transitions: [], muted: false, hidden: false,
          clips: [{ id: "c2", kind: "audio", src: "assets/audio/b.mp3", in: 0, out: 3, trackOffset: 0, transforms: {} as any, filters: {} as any } as any],
        },
        {
          id: "to", kind: "overlay", label: "O", displayOrder: 2, volume: 0, transitions: [], muted: false, hidden: false,
          clips: [{ id: "c3", kind: "overlay", src: "assets/overlays/c.png", in: 0, out: 3, trackOffset: 0, transforms: {} as any, filters: {} as any, position: { x: 0, y: 0, w: 100, h: 100 } } as any],
        },
        {
          id: "tt", kind: "text", label: "T", displayOrder: 3, volume: 0, transitions: [], muted: false, hidden: false,
          clips: [{ id: "c4", kind: "text", text: "hello", in: 0, out: 3, trackOffset: 0 } as any],
        },
      ],
    };
    const out = resolveCompositionAssets(comp);
    expect((out.tracks[0].clips[0] as any).src).toBe("/api/works/w_1/assets/videos/a.mp4");
    expect((out.tracks[1].clips[0] as any).src).toBe("/api/works/w_1/assets/audio/b.mp3");
    expect((out.tracks[2].clips[0] as any).src).toBe("/api/works/w_1/assets/overlays/c.png");
    // Text clip preserved as-is (no src field).
    expect(out.tracks[3].clips[0]).toEqual(comp.tracks[3].clips[0]);
  });

  it("preserves clip identity when src is already a full URL", () => {
    const comp: Composition = {
      ...baseComp(),
      tracks: [{
        id: "t", kind: "video", label: "V", displayOrder: 0, volume: 0, transitions: [], muted: false, hidden: false,
        clips: [{ id: "c", kind: "video", src: "https://cdn/x.mp4", in: 0, out: 3, trackOffset: 0, fitMode: "cover", transforms: {} as any, filters: {} as any }],
      }],
    };
    const out = resolveCompositionAssets(comp);
    expect((out.tracks[0].clips[0] as any).src).toBe("https://cdn/x.mp4");
  });
});
