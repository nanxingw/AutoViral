import type { AssetEntry, Composition, ProvenanceEdge } from "../types";

/**
 * Walk the provenance DAG rooted at `rootAssetId`.
 *
 *   ancestors    — chain of `fromAssetId` parents, ordered nearest → furthest.
 *                  Stops at fromAssetId === null. Linear chain assumed (each
 *                  asset has at most one ProvenanceEdge in comp.provenance).
 *   descendants  — BFS of edges where fromAssetId === currentNode, then their
 *                  descendants, etc. Order: BFS layer-by-layer; within a layer,
 *                  preserves the edge order from comp.provenance.
 *   siblings     — assets that share the same fromAssetId as rootAssetId.
 *                  Per D5, root assets (fromAssetId === null) get [] not the
 *                  set of all other roots.
 *
 * Lookups against missing ids/edges are silent: callers can pass anything
 * and get back empty arrays. No exceptions.
 */
export interface ProvenanceWalk {
  ancestors: AssetEntry[];
  descendants: AssetEntry[];
  siblings: AssetEntry[];
}

export function walkProvenance(
  comp: Composition,
  rootAssetId: string,
): ProvenanceWalk {
  const assets = comp.assets;
  const edges: ProvenanceEdge[] = comp.provenance;
  const assetById = new Map(assets.map((a) => [a.id, a] as const));
  if (!assetById.has(rootAssetId)) {
    return { ancestors: [], descendants: [], siblings: [] };
  }

  // Index: child → parent (for ancestor walk + sibling lookup)
  const parentOf = new Map<string, string | null>();
  // Index: parent → ordered children (for descendant BFS)
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    parentOf.set(e.toAssetId, e.fromAssetId);
    if (e.fromAssetId != null) {
      const list = childrenOf.get(e.fromAssetId) ?? [];
      list.push(e.toAssetId);
      childrenOf.set(e.fromAssetId, list);
    }
  }

  // Ancestors: walk backward from root.
  const ancestors: AssetEntry[] = [];
  let cursor: string | null = parentOf.get(rootAssetId) ?? null;
  while (cursor != null) {
    const a = assetById.get(cursor);
    if (!a) break;
    ancestors.push(a);
    cursor = parentOf.get(cursor) ?? null;
  }

  // Descendants: BFS.
  const descendants: AssetEntry[] = [];
  const queue = [...(childrenOf.get(rootAssetId) ?? [])];
  const seen = new Set<string>([rootAssetId]);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = assetById.get(id);
    if (a) descendants.push(a);
    for (const c of childrenOf.get(id) ?? []) queue.push(c);
  }

  // Siblings: assets with the same parent. D5: root → [].
  const myParent = parentOf.get(rootAssetId) ?? null;
  let siblings: AssetEntry[] = [];
  if (myParent != null) {
    siblings = (childrenOf.get(myParent) ?? [])
      .filter((id) => id !== rootAssetId)
      .map((id) => assetById.get(id))
      .filter((a): a is AssetEntry => !!a);
  }

  return { ancestors, descendants, siblings };
}

/**
 * Reverse-lookup: given a clip.src URI, return the AssetEntry that owns it.
 * Phase 5 binding model: clip→asset is by URI (not by assetId on the clip).
 * Returns null when no asset matches.
 */
export function findAssetByUri(
  comp: Composition,
  uri: string,
): AssetEntry | null {
  return comp.assets.find((a) => a.uri === uri) ?? null;
}
