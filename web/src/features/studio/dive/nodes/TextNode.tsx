import type { NodeProps } from "reactflow";
import type { AssetEntry } from "../../types";
import { NodeShell } from "./NodeShell";

export interface TextNodeData {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export function TextNode({ data }: NodeProps<TextNodeData>) {
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
