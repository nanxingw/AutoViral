import { describe, it, expect } from "vitest";
import { synthesiseLegacyAssetsAndProvenance } from "../api.js";
import type { Composition } from "../../shared/composition.js";

describe("synthesiseLegacyAssetsAndProvenance", () => {
  it("creates one AssetEntry per VideoClip and one ProvenanceEdge with type=import", () => {
    const legacy: Composition = {
      id: "c_w1", workId: "w1", fps: 30, width: 1080, height: 1920,
      duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [
        { id: "video-0", kind: "video", label: "Video", muted: false, hidden: false,
      volume: 0, displayOrder: 0, transitions: [],
          clips: [{ id: "clip-1", kind: "video",
            src: "/api/works/w1/assets/clips/shot1.mp4",
            in: 0, out: 4, trackOffset: 0, fitMode: "cover",
            transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
            filters: { brightness: 0, contrast: 0, saturation: 0 } }] },
      ],
      assets: [], provenance: [], exportPresets: [],
    };
    const enriched = synthesiseLegacyAssetsAndProvenance(legacy);
    expect(enriched.assets).toHaveLength(1);
    expect(enriched.assets[0].uri).toBe("/api/works/w1/assets/clips/shot1.mp4");
    expect(enriched.assets[0].kind).toBe("video");
    expect(enriched.provenance).toHaveLength(1);
    expect(enriched.provenance[0].fromAssetId).toBeNull();
    expect(enriched.provenance[0].operation.type).toBe("import");
    expect(enriched.provenance[0].operation.actor).toBe("system");
  });

  it("does not duplicate AssetEntry when assets[] is already populated", () => {
    const already: Composition = {
      id: "c_w2", workId: "w2", fps: 30, width: 1080, height: 1920,
      duration: 4, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [{ id: "video-0", kind: "video", label: "Video",
        muted: false, hidden: false, volume: 0, displayOrder: 0, transitions: [], clips: [
          { id: "clip-x", kind: "video", src: "/a/clips/x.mp4",
            in: 0, out: 4, trackOffset: 0, fitMode: "cover",
            transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
            filters: { brightness: 0, contrast: 0, saturation: 0 } }] }],
      assets: [{ id: "asset-x", uri: "/a/clips/x.mp4", kind: "video",
        metadata: {}, status: "ready" }],
      provenance: [{ toAssetId: "asset-x", fromAssetId: null,
        operation: { type: "upload", actor: "user",
          timestamp: "2026-04-27T00:00:00Z", params: {} } }],
      exportPresets: [],
    };
    const r = synthesiseLegacyAssetsAndProvenance(already);
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0].id).toBe("asset-x");
    expect(r.provenance[0].operation.type).toBe("upload");
  });

  it("dedupes assets by src across multiple clips on the same track", () => {
    const sharedSrc = "/api/works/w3/assets/clips/shared.mp4";
    const legacy: Composition = {
      id: "c_w3", workId: "w3", fps: 30, width: 1080, height: 1920,
      duration: 8, aspect: "9:16", updatedAt: "2026-04-28T00:00:00Z",
      tracks: [
        { id: "video-0", kind: "video", label: "Video", muted: false, hidden: false,
      volume: 0, displayOrder: 0, transitions: [],
          clips: [
            { id: "clip-a", kind: "video", src: sharedSrc, in: 0, out: 4, trackOffset: 0,
              fitMode: "cover",
              transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
              filters: { brightness: 0, contrast: 0, saturation: 0 } },
            { id: "clip-b", kind: "video", src: sharedSrc, in: 0, out: 4, trackOffset: 4,
              fitMode: "cover",
              transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
              filters: { brightness: 0, contrast: 0, saturation: 0 } },
          ] },
      ],
      assets: [], provenance: [], exportPresets: [],
    };
    const enriched = synthesiseLegacyAssetsAndProvenance(legacy);
    expect(enriched.assets).toHaveLength(1);
    expect(enriched.assets[0].uri).toBe(sharedSrc);
    expect(enriched.provenance).toHaveLength(1);
  });
});
