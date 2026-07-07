import {
  computeTreeLayout,
  type LayoutEdge,
  type NodePosition,
} from "./useTreeLayout";
import type { SceneCluster } from "./useSceneClusters";

// B5 (PRD-0010) — turn scene clusters into an xyflow compound layout:
//   • each cluster becomes a GROUP node (absolute position + width/height)
//   • each member asset becomes a CHILD node positioned RELATIVE to its group
//     (xyflow parentId semantics: child.position is measured from the group's
//     top-left, NOT the canvas origin)
// Intra-cluster placement reuses the LR Dagre layout. Scene clusters flow
// LEFT-TO-RIGHT on one top-aligned row — 镜1 → 镜N reads like the film's own
// timeline (scenes are already order-sorted upstream). The unassigned bucket
// is NOT part of the timeline: it drops to its own second row below the
// tallest scene cluster, starting back at x=0.

/** Space reserved at the top of each group for a B6 title bar. */
export const CLUSTER_HEADER = 44;
/** Inner padding around the member nodes inside a group. */
export const CLUSTER_PADDING = 24;
/** Gap between clusters — horizontal along the timeline row, and vertical
 *  between the timeline row and the unassigned row. */
export const CLUSTER_GAP = 56;

export interface ClusterBox {
  id: string;
  /** Absolute top-left of the group node on the canvas. */
  position: NodePosition;
  width: number;
  height: number;
}

export interface ChildPlacement {
  parentId: string;
  /** Position RELATIVE to the parent group's top-left. */
  position: NodePosition;
}

export interface ClusterLayout {
  groups: Map<string, ClusterBox>;
  children: Map<string, ChildPlacement>;
}

export function computeClusterLayout(
  clusters: SceneCluster[],
  edges: LayoutEdge[],
  nodeWidth: number,
  nodeHeight: number,
): ClusterLayout {
  const groups = new Map<string, ClusterBox>();
  const children = new Map<string, ChildPlacement>();
  // Timeline row cursor (scene clusters) + the row's running max height,
  // which decides where the unassigned row starts.
  let cursorX = 0;
  let timelineBottom = 0;

  const sized: Array<{ cluster: SceneCluster; width: number; height: number }> = [];

  for (const cluster of clusters) {
    const idSet = new Set(cluster.assetIds);
    const layoutNodes = cluster.assetIds.map((id) => ({
      id,
      width: nodeWidth,
      height: nodeHeight,
    }));
    // Only edges wholly inside this cluster drive its internal layout.
    const intraEdges = edges.filter(
      (e) => idSet.has(e.source) && idSet.has(e.target),
    );
    const local = computeTreeLayout(layoutNodes, intraEdges); // top-left coords

    let maxRight = nodeWidth;
    let maxBottom = nodeHeight;
    for (const id of cluster.assetIds) {
      const p = local.get(id) ?? { x: 0, y: 0 };
      // Offset by header + padding so children clear the (B6) title bar.
      const relX = p.x + CLUSTER_PADDING;
      const relY = p.y + CLUSTER_HEADER;
      children.set(id, { parentId: cluster.id, position: { x: relX, y: relY } });
      maxRight = Math.max(maxRight, relX + nodeWidth);
      maxBottom = Math.max(maxBottom, relY + nodeHeight);
    }

    sized.push({
      cluster,
      width: maxRight + CLUSTER_PADDING,
      height: maxBottom + CLUSTER_PADDING,
    });
  }

  // Pass 1 — scene clusters advance along the timeline row.
  for (const { cluster, width, height } of sized) {
    if (cluster.isUnassigned) continue;
    groups.set(cluster.id, {
      id: cluster.id,
      position: { x: cursorX, y: 0 },
      width,
      height,
    });
    cursorX += width + CLUSTER_GAP;
    timelineBottom = Math.max(timelineBottom, height);
  }

  // Pass 2 — the unassigned bucket sinks to its own row (origin when there
  // is no timeline row at all).
  for (const { cluster, width, height } of sized) {
    if (!cluster.isUnassigned) continue;
    groups.set(cluster.id, {
      id: cluster.id,
      position: {
        x: 0,
        y: timelineBottom > 0 ? timelineBottom + CLUSTER_GAP : 0,
      },
      width,
      height,
    });
  }

  return { groups, children };
}
