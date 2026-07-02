import { useMemo } from "react";
import type { Composition, Scene } from "../types";
import { walkProvenance } from "./walkProvenance";

// B5 (PRD-0010) — the Dive canvas groups assets by 分镜 (scene) instead of a
// flat provenance DAG. `computeSceneClusters` is the pure kernel: it maps a
// composition to an ordered set of clusters. Membership rules:
//
//   • a scene's cluster members = scene.memberAssetIds ∪ scene.generatedAssetIds
//   • scene.selectedAssetId marks the chosen take (highlighted in the UI)
//   • a derived asset with no direct scene reference is adopted into the
//     cluster of its NEAREST directly-owned provenance ancestor
//   • an asset owned by neither itself nor any ancestor lands in the single
//     "__unassigned__" cluster (rendered last)
//   • when a composition has no scenes, every asset is unassigned
//   • when two scenes reference the same asset, the SMALLER-order scene wins
//
// A scene whose members do not resolve to any real asset emits NO cluster
// (empty group boxes are noise); the same goes for the unassigned cluster.

export const UNASSIGNED_CLUSTER_ID = "__unassigned__";

export interface SceneCluster {
  /** Cluster id — the scene id, or UNASSIGNED_CLUSTER_ID for the fallback. */
  id: string;
  /** Source scene id, or null for the unassigned cluster. */
  sceneId: string | null;
  /** The source scene record (null for unassigned) — lets B6 read title/intent. */
  scene: Scene | null;
  /** scene.order; the unassigned cluster sorts last. */
  order: number;
  isUnassigned: boolean;
  /** Member asset ids, in comp.assets order (stable). */
  assetIds: string[];
  /** The selected take, iff it actually belongs to this cluster; else null. */
  selectedAssetId: string | null;
}

export function computeSceneClusters(comp: Composition | null): SceneCluster[] {
  if (!comp) return [];
  const assets = comp.assets ?? [];
  // Sort a COPY by order so array position never decides ownership.
  const scenes = [...(comp.scenes ?? [])].sort((a, b) => a.order - b.order);

  // 1. Direct ownership: assetId → owning scene id. Iterating in ascending
  //    order + first-write-wins makes the smaller-order scene win on conflict.
  const directOwner = new Map<string, string>();
  for (const scene of scenes) {
    for (const aid of [
      ...(scene.memberAssetIds ?? []),
      ...(scene.generatedAssetIds ?? []),
    ]) {
      if (!directOwner.has(aid)) directOwner.set(aid, scene.id);
    }
  }

  // Resolve an asset to a scene id: direct, else the nearest owned ancestor.
  const resolveOwner = (assetId: string): string | null => {
    const direct = directOwner.get(assetId);
    if (direct) return direct;
    const { ancestors } = walkProvenance(comp, assetId); // nearest → furthest
    for (const anc of ancestors) {
      const owner = directOwner.get(anc.id);
      if (owner) return owner;
    }
    return null;
  };

  // 2. Bucket every real asset (comp.assets order = stable member order).
  const members = new Map<string, string[]>();
  for (const scene of scenes) members.set(scene.id, []);
  const unassigned: string[] = [];
  for (const asset of assets) {
    const owner = resolveOwner(asset.id);
    if (owner && members.has(owner)) members.get(owner)!.push(asset.id);
    else unassigned.push(asset.id);
  }

  // 3. Emit non-empty scene clusters (in order), then unassigned (if any).
  const clusters: SceneCluster[] = [];
  for (const scene of scenes) {
    const ids = members.get(scene.id)!;
    if (ids.length === 0) continue;
    const selected =
      scene.selectedAssetId && ids.includes(scene.selectedAssetId)
        ? scene.selectedAssetId
        : null;
    clusters.push({
      id: scene.id,
      sceneId: scene.id,
      scene,
      order: scene.order,
      isUnassigned: false,
      assetIds: ids,
      selectedAssetId: selected,
    });
  }
  if (unassigned.length > 0) {
    clusters.push({
      id: UNASSIGNED_CLUSTER_ID,
      sceneId: null,
      scene: null,
      order: Number.MAX_SAFE_INTEGER,
      isUnassigned: true,
      assetIds: unassigned,
      selectedAssetId: null,
    });
  }
  return clusters;
}

/** React hook wrapper — memoises clusters against the composition. */
export function useSceneClusters(comp: Composition | null): SceneCluster[] {
  return useMemo(() => computeSceneClusters(comp), [comp]);
}
