import { describe, it, expect } from "vitest";
import {
  computeClusterLayout,
  CLUSTER_HEADER,
  CLUSTER_PADDING,
  CLUSTER_GAP,
} from "./clusterLayout";
import type { SceneCluster } from "./useSceneClusters";

const W = 180;
const H = 120;

function cluster(id: string, assetIds: string[]): SceneCluster {
  return {
    id,
    sceneId: id,
    scene: null,
    order: 0,
    isUnassigned: false,
    assetIds,
    selectedAssetId: null,
  };
}

describe("computeClusterLayout", () => {
  it("returns empty maps for no clusters", () => {
    const { groups, children } = computeClusterLayout([], [], W, H);
    expect(groups.size).toBe(0);
    expect(children.size).toBe(0);
  });

  it("child positions are RELATIVE to their group (parent-offset conversion)", () => {
    // Two single-asset clusters stacked vertically. Each sole child gets the
    // SAME relative position, while the groups sit at DIFFERENT absolute y.
    const clusters = [cluster("c0", ["x0"]), cluster("c1", ["x1"])];
    const { groups, children } = computeClusterLayout(clusters, [], W, H);

    const g0 = groups.get("c0")!;
    const g1 = groups.get("c1")!;
    const kid0 = children.get("x0")!;
    const kid1 = children.get("x1")!;

    // Groups do NOT overlap in y — c1 sits below c0.
    expect(g0.position.y).toBe(0);
    expect(g1.position.y).toBe(g0.height + CLUSTER_GAP);
    expect(g1.position.y).toBeGreaterThan(g0.position.y);

    // Relative child position is identical across the two clusters — it does
    // NOT carry the group's absolute offset (that's the whole point of
    // parentId + relative coords).
    expect(kid0.position).toEqual(kid1.position);
    expect(kid0.parentId).toBe("c0");
    expect(kid1.parentId).toBe("c1");

    // Header + padding are reserved so a B6 title bar has room.
    expect(kid0.position.y).toBeGreaterThanOrEqual(CLUSTER_HEADER);
    expect(kid0.position.x).toBeGreaterThanOrEqual(CLUSTER_PADDING);
  });

  it("each child stays inside its group's bounding box (containment)", () => {
    const clusters = [cluster("c0", ["a", "b", "c"])];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const { groups, children } = computeClusterLayout(clusters, edges, W, H);
    const g = groups.get("c0")!;
    for (const id of ["a", "b", "c"]) {
      const kid = children.get(id)!;
      expect(kid.position.x + W).toBeLessThanOrEqual(g.width);
      expect(kid.position.y + H).toBeLessThanOrEqual(g.height);
    }
  });

  it("lays out an intra-cluster chain left-to-right (LR rankdir)", () => {
    const clusters = [cluster("c0", ["a", "b", "c"])];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const { children } = computeClusterLayout(clusters, edges, W, H);
    const xa = children.get("a")!.position.x;
    const xb = children.get("b")!.position.x;
    const xc = children.get("c")!.position.x;
    expect(xa).toBeLessThan(xb);
    expect(xb).toBeLessThan(xc);
  });

  it("only uses intra-cluster edges for layout (cross-cluster edge ignored)", () => {
    // Edge a→z crosses cluster boundary; it must not throw or misplace.
    const clusters = [cluster("c0", ["a"]), cluster("c1", ["z"])];
    const edges = [{ source: "a", target: "z" }];
    const { groups, children } = computeClusterLayout(clusters, edges, W, H);
    expect(groups.size).toBe(2);
    expect(children.get("a")!.parentId).toBe("c0");
    expect(children.get("z")!.parentId).toBe("c1");
  });
});
