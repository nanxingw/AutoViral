import type { Node } from "@xyflow/react";

// Item 6 — colour a minimap node by its Dive node type so the map reads as a
// legend, not a grey blob. Returns CSS custom-property references so the colours
// stay theme-reactive (xyflow writes the return value as the SVG rect `fill`;
// var() resolves against the cascade). Kept as a pure function so the mapping is
// unit-testable without a ReactFlow provider.

export function miniMapNodeColor(node: Pick<Node, "type">): string {
  switch (node.type) {
    case "visual":
      return "var(--accent-lo)";
    case "audio":
      return "var(--status-running)";
    case "text":
      return "var(--text-dimmer)";
    case "sceneGroup":
      return "var(--glass-hi)";
    default:
      return "var(--glass-hi)";
  }
}
