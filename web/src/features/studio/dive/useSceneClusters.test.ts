import { describe, it, expect } from "vitest";
import {
  computeSceneClusters,
  UNASSIGNED_CLUSTER_ID,
} from "./useSceneClusters";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

// B5 (PRD-0010) — computeSceneClusters is the pure kernel behind the clustered
// Dive canvas: composition → scene clusters. Membership rules (from the slice
// spec) that these tests lock:
//   • cluster members = scene.memberAssetIds ∪ scene.generatedAssetIds
//   • scene.selectedAssetId marks the "USE THIS" take
//   • derived assets with no direct scene ref fall into the cluster of their
//     nearest owned provenance ancestor
//   • assets with no attribution land in the "__unassigned__" cluster
//   • no scenes → everything is unassigned
//   • an asset referenced by two scenes belongs to the SMALLER-order scene

describe("computeSceneClusters", () => {
  it("returns no clusters for a null composition", () => {
    expect(computeSceneClusters(null)).toEqual([]);
  });

  it("no scenes → every asset lands in a single unassigned cluster", () => {
    const comp = makeAssetGraph({ ids: ["a", "b", "c"] });
    const clusters = computeSceneClusters(comp);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe(UNASSIGNED_CLUSTER_ID);
    expect(clusters[0].isUnassigned).toBe(true);
    expect(clusters[0].assetIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("groups memberAssetIds ∪ generatedAssetIds into the scene's cluster", () => {
    const comp = makeAssetGraph({ ids: ["m1", "g1", "loose"] });
    comp.scenes = [
      makeScene({
        id: "sc1",
        order: 0,
        memberAssetIds: ["m1"],
        generatedAssetIds: ["g1"],
      }),
    ];
    const clusters = computeSceneClusters(comp);
    // sc1 cluster + unassigned (loose).
    expect(clusters.map((c) => c.id)).toEqual(["sc1", UNASSIGNED_CLUSTER_ID]);
    const sc1 = clusters.find((c) => c.id === "sc1")!;
    expect(sc1.assetIds.sort()).toEqual(["g1", "m1"]);
    const un = clusters.find((c) => c.isUnassigned)!;
    expect(un.assetIds).toEqual(["loose"]);
  });

  it("marks the selected take when it belongs to the cluster", () => {
    const comp = makeAssetGraph({ ids: ["g1", "g2"] });
    comp.scenes = [
      makeScene({
        id: "sc1",
        order: 0,
        generatedAssetIds: ["g1", "g2"],
        selectedAssetId: "g2",
      }),
    ];
    const [sc1] = computeSceneClusters(comp);
    expect(sc1.selectedAssetId).toBe("g2");
  });

  it("does NOT mark a selected take that resolved into a different cluster", () => {
    const comp = makeAssetGraph({ ids: ["g1"] });
    comp.scenes = [
      // selectedAssetId points at an asset not owned by this scene.
      makeScene({
        id: "sc1",
        order: 0,
        generatedAssetIds: ["g1"],
        selectedAssetId: "ghost",
      }),
    ];
    const [sc1] = computeSceneClusters(comp);
    expect(sc1.selectedAssetId).toBeNull();
  });

  it("adopts a derived asset into its nearest owned ancestor's cluster", () => {
    // base ∈ scene sc1; derived ← base via provenance, not referenced by any
    // scene directly. derived must fall into sc1 via the ancestor chain.
    const comp = makeAssetGraph({
      ids: ["base", "derived"],
      edges: [["base", "derived"]],
    });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["base"] })];
    const clusters = computeSceneClusters(comp);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe("sc1");
    expect(clusters[0].assetIds.sort()).toEqual(["base", "derived"]);
  });

  it("walks multiple provenance levels to find an owned ancestor", () => {
    // owned ← child ← grandchild ; only `owned` is scene-referenced.
    const comp = makeAssetGraph({
      ids: ["owned", "child", "grandchild"],
      edges: [["owned", "child"], ["child", "grandchild"]],
    });
    comp.scenes = [makeScene({ id: "sc1", order: 0, generatedAssetIds: ["owned"] })];
    const [sc1] = computeSceneClusters(comp);
    expect(sc1.assetIds.sort()).toEqual(["child", "grandchild", "owned"]);
  });

  it("falls back to unassigned when neither the asset nor any ancestor is owned", () => {
    const comp = makeAssetGraph({
      ids: ["orphanRoot", "orphanChild"],
      edges: [["orphanRoot", "orphanChild"]],
    });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["nope"] })];
    const clusters = computeSceneClusters(comp);
    // sc1 has no resolvable members → omitted; both orphans go unassigned.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe(UNASSIGNED_CLUSTER_ID);
    expect(clusters[0].assetIds.sort()).toEqual(["orphanChild", "orphanRoot"]);
  });

  it("assigns an asset referenced by two scenes to the smaller-order scene", () => {
    const comp = makeAssetGraph({ ids: ["shared"] });
    // Deliberately list the higher-order scene FIRST to prove ordering, not
    // array position, decides ownership.
    comp.scenes = [
      makeScene({ id: "late", order: 3, memberAssetIds: ["shared"] }),
      makeScene({ id: "early", order: 1, memberAssetIds: ["shared"] }),
    ];
    const clusters = computeSceneClusters(comp);
    const early = clusters.find((c) => c.id === "early");
    const late = clusters.find((c) => c.id === "late");
    expect(early?.assetIds).toEqual(["shared"]);
    expect(late).toBeUndefined(); // late has no remaining members → omitted
  });

  it("emits scene clusters ordered by scene.order with unassigned last", () => {
    const comp = makeAssetGraph({ ids: ["a2", "a1", "loose"] });
    comp.scenes = [
      makeScene({ id: "second", order: 2, memberAssetIds: ["a2"] }),
      makeScene({ id: "first", order: 1, memberAssetIds: ["a1"] }),
    ];
    const clusters = computeSceneClusters(comp);
    expect(clusters.map((c) => c.id)).toEqual([
      "first",
      "second",
      UNASSIGNED_CLUSTER_ID,
    ]);
  });

  it("B7: an i2v video adopts into its 定妆照's scene via the firstFrame provenance edge", () => {
    // The concrete B7 scenario: a firstFrame image (定妆照) is a scene member;
    // the i2v video B7 now writes with fromAssetId = that image has NO direct
    // scene reference — it must adopt into the image's scene via the ancestor
    // chain, so the canvas draws the "定妆照 → 视频" link inside one cluster.
    const comp = makeAssetGraph({
      ids: ["anchor", "i2vClip"],
      edges: [["anchor", "i2vClip"]],
      overrides: {
        anchor: { kind: "image", uri: "assets/images/anchor.png" },
        i2vClip: { kind: "video", uri: "assets/seedance/clip.mp4" },
      },
    });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["anchor"] })];
    const clusters = computeSceneClusters(comp);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe("sc1");
    expect(clusters[0].assetIds.sort()).toEqual(["anchor", "i2vClip"]);
  });

  it("omits scenes whose members do not resolve to any real asset", () => {
    const comp = makeAssetGraph({ ids: ["real"] });
    comp.scenes = [
      makeScene({ id: "empty", order: 0, memberAssetIds: ["doesNotExist"] }),
      makeScene({ id: "full", order: 1, memberAssetIds: ["real"] }),
    ];
    const clusters = computeSceneClusters(comp);
    expect(clusters.map((c) => c.id)).toEqual(["full"]);
  });
});
