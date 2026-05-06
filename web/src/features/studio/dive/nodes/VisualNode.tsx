import type { NodeProps } from "reactflow";
import type { AssetEntry } from "../../types";
import { NodeShell } from "./NodeShell";

export interface VisualNodeData {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export function VisualNode({ data }: NodeProps<VisualNodeData>) {
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
