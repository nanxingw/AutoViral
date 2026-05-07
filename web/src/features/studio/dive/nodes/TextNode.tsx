import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";

export function TextNode({ data }: NodeProps<DiveNode>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 12,
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          fontFamily: "var(--font-editorial)",
          fontStyle: "italic",
          fontSize: 28,
          letterSpacing: "-0.02em",
        }}
      >
        Aa
      </div>
    </NodeShell>
  );
}
