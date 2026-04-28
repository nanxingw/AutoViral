import { describe, it, expect } from "vitest";
import { AssetEntrySchema, ProvenanceEdgeSchema } from "../types";

describe("AssetEntrySchema", () => {
  it("parses a minimum valid image entry", () => {
    const r = AssetEntrySchema.parse({
      id: "asset-hero",
      uri: "/api/works/w_x/assets/images/hero.png",
      kind: "image",
      metadata: {},
    });
    expect(r.id).toBe("asset-hero");
    expect(r.kind).toBe("image");
    expect(r.tags).toBeUndefined();
  });

  it("preserves physical metadata fields verbatim", () => {
    const r = AssetEntrySchema.parse({
      id: "asset-clip-1",
      uri: "/api/works/w_x/assets/clips/c.mp4",
      kind: "video",
      metadata: { width: 1080, height: 1920, duration: 4.04, fps: 30, codec: "h264", sizeBytes: 1234567 },
    });
    expect(r.metadata.duration).toBe(4.04);
    expect(r.metadata.codec).toBe("h264");
    expect(r.metadata.sizeBytes).toBe(1234567);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      AssetEntrySchema.parse({ id: "x", uri: "/a", kind: "weird", metadata: {} }),
    ).toThrow();
  });
});

describe("ProvenanceEdgeSchema", () => {
  it("parses a generate edge with null fromAssetId", () => {
    const r = ProvenanceEdgeSchema.parse({
      toAssetId: "asset-hero",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        agentId: "autoviral-imagegen",
        timestamp: "2026-04-28T10:00:00Z",
        params: { model: "openai/gpt-5.4-image-2", prompt: "panda" },
      },
    });
    expect(r.fromAssetId).toBeNull();
    expect(r.operation.type).toBe("generate");
    expect(r.operation.params.model).toBe("openai/gpt-5.4-image-2");
  });

  it("parses a derive edge with non-null fromAssetId", () => {
    const r = ProvenanceEdgeSchema.parse({
      toAssetId: "asset-panda-v2",
      fromAssetId: "asset-panda-v1",
      operation: {
        type: "derive",
        actor: "agent",
        timestamp: "2026-04-28T10:01:00Z",
        params: {},
      },
    });
    expect(r.fromAssetId).toBe("asset-panda-v1");
  });

  it("rejects invalid operation.type", () => {
    expect(() =>
      ProvenanceEdgeSchema.parse({
        toAssetId: "x",
        fromAssetId: null,
        operation: { type: "magic", actor: "agent", timestamp: "t", params: {} },
      }),
    ).toThrow();
  });
});
