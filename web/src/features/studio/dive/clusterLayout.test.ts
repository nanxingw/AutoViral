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

function cluster(
  id: string,
  assetIds: string[],
  isUnassigned = false,
): SceneCluster {
  return {
    id,
    sceneId: isUnassigned ? null : id,
    scene: null,
    order: 0,
    isUnassigned,
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

  it("scene clusters flow LEFT-TO-RIGHT on one top-aligned timeline row", () => {
    // 镜1 → 镜2 read like the film's timeline: groups advance in x, share y=0.
    const clusters = [cluster("c0", ["x0"]), cluster("c1", ["x1"])];
    const { groups, children } = computeClusterLayout(clusters, [], W, H);

    const g0 = groups.get("c0")!;
    const g1 = groups.get("c1")!;
    const kid0 = children.get("x0")!;
    const kid1 = children.get("x1")!;

    // Groups do NOT overlap in x — c1 sits to the RIGHT of c0, both top-aligned.
    expect(g0.position.x).toBe(0);
    expect(g1.position.x).toBe(g0.width + CLUSTER_GAP);
    expect(g0.position.y).toBe(0);
    expect(g1.position.y).toBe(0);

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

  it("the unassigned bucket drops to its OWN row below the timeline", () => {
    // Timeline row keeps only real scenes; unassigned material sinks to a
    // second row starting back at x=0, clear of the tallest scene cluster.
    const clusters = [
      cluster("s0", ["a"]),
      cluster("s1", ["b", "b2"]),
      cluster("__unassigned__", ["u1", "u2"], true),
    ];
    const { groups } = computeClusterLayout(clusters, [], W, H);
    const s0 = groups.get("s0")!;
    const s1 = groups.get("s1")!;
    const un = groups.get("__unassigned__")!;

    const timelineBottom = Math.max(s0.height, s1.height);
    expect(un.position.x).toBe(0);
    expect(un.position.y).toBe(timelineBottom + CLUSTER_GAP);
    // Scene clusters are untouched by the bucket's presence.
    expect(s0.position).toEqual({ x: 0, y: 0 });
    expect(s1.position.x).toBe(s0.width + CLUSTER_GAP);
    expect(s1.position.y).toBe(0);
  });

  it("an unassigned-only work keeps the bucket at the origin", () => {
    const clusters = [cluster("__unassigned__", ["u1"], true)];
    const { groups } = computeClusterLayout(clusters, [], W, H);
    expect(groups.get("__unassigned__")!.position).toEqual({ x: 0, y: 0 });
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
