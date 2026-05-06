import dagre from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Compute LR-rankdir Dagre layout for a provenance DAG.
 * Returns a Map<id → {x, y}>. The x/y refer to the *top-left* corner
 * (Dagre's center-anchor is converted by subtracting half-width/height).
 *
 * Pure: same input → same output, no internal state. Despite the `use*`
 * name (kept to match master plan §5.0 file-structure spec), this is NOT
 * a React hook — no useState/useEffect — and is safe to call inside a
 * useMemo.
 */
export function useTreeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  if (nodes.length === 0) return out;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of edges) {
    // Skip edges that reference unknown nodes (defensive — shouldn't happen
    // with well-formed provenance, but a stray edge mustn't crash layout).
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const node = g.node(n.id);
    if (!node) continue;
    out.set(n.id, {
      x: node.x - n.width / 2,
      y: node.y - n.height / 2,
    });
  }
  return out;
}
