import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";

export function VisualNode({ data }: NodeProps<DiveNode>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <img
        src={data.asset.uri}
        alt={data.asset.name ?? data.asset.id}
        loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    </NodeShell>
  );
}
