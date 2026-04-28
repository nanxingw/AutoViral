import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";

describe("studio store provenance actions", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w_test" }),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
    });
  });

  it("addAsset appends to comp.assets", () => {
    useComposition.getState().addAsset({
      id: "asset-x",
      uri: "/api/works/w_test/assets/clips/x.mp4",
      kind: "video",
      metadata: {},
      status: "ready",
    });
    expect(useComposition.getState().comp!.assets).toHaveLength(1);
    expect(useComposition.getState().comp!.assets[0].id).toBe("asset-x");
  });

  it("addAsset is idempotent on id (no-op when asset already present)", () => {
    const a = {
      id: "asset-dup",
      uri: "/u",
      kind: "image" as const,
      metadata: {},
      status: "ready" as const,
    };
    useComposition.getState().addAsset(a);
    useComposition.getState().addAsset(a);
    expect(useComposition.getState().comp!.assets).toHaveLength(1);
  });

  it("addProvenance appends to comp.provenance", () => {
    useComposition.getState().addProvenance({
      toAssetId: "asset-x",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        timestamp: "2026-04-28T10:00:00Z",
        params: {},
      },
    });
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
  });

  it("removeAsset removes the asset and edges with that toAssetId, but preserves edges deriving FROM it", () => {
    const s = useComposition.getState();
    s.addAsset({
      id: "asset-y",
      uri: "/y",
      kind: "image",
      metadata: {},
      status: "ready",
    });
    s.addProvenance({
      toAssetId: "asset-y",
      fromAssetId: null,
      operation: { type: "generate", actor: "agent", timestamp: "t", params: {} },
    });
    s.addProvenance({
      toAssetId: "asset-z",
      fromAssetId: "asset-y",
      operation: { type: "derive", actor: "agent", timestamp: "t", params: {} },
    });
    s.removeAsset("asset-y");
    expect(useComposition.getState().comp!.assets).toHaveLength(0);
    // Edges where toAssetId === asset-y are removed; edges that DERIVED from
    // asset-y keep their fromAssetId so the lineage stays visible (broken-link
    // state is reconciled by the dive view in Phase 5).
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
    expect(useComposition.getState().comp!.provenance[0].toAssetId).toBe("asset-z");
  });
});
