import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";

export function AudioNode({ data }: NodeProps<DiveNode>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          background: "linear-gradient(145deg, rgba(168,197,214,0.08), transparent)",
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <polygon points="12 6 7 11 3 11 3 13 7 13 12 18 12 6" fill="currentColor" />
          <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />
        </svg>
      </div>
    </NodeShell>
  );
}
