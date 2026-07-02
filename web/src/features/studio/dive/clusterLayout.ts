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
// Intra-cluster placement reuses the LR Dagre layout; clusters stack top-to-
// bottom by their input order (scenes are already order-sorted upstream).

/** Space reserved at the top of each group for a B6 title bar. */
export const CLUSTER_HEADER = 44;
/** Inner padding around the member nodes inside a group. */
export const CLUSTER_PADDING = 24;
/** Vertical gap between stacked clusters. */
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
  let cursorY = 0;

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

    const width = maxRight + CLUSTER_PADDING;
    const height = maxBottom + CLUSTER_PADDING;
    groups.set(cluster.id, {
      id: cluster.id,
      position: { x: 0, y: cursorY },
      width,
      height,
    });
    cursorY += height + CLUSTER_GAP;
  }

  return { groups, children };
}
