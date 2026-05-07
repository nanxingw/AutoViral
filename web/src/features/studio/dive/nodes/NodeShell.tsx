import { Handle, Position, type Node } from "@xyflow/react";
import type { ReactNode } from "react";
import type { AssetEntry } from "../../types";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 120;

export interface DiveNodeData extends Record<string, unknown> {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export type DiveNode = Node<DiveNodeData>;

export interface NodeShellProps {
  assetId: string;
  isCurrent: boolean;
  onUse: () => void;
  children: ReactNode;
}

export function NodeShell({ assetId, isCurrent, onUse, children }: NodeShellProps) {
  return (
    <div
      data-testid={`dive-node-${assetId}`}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        position: "relative",
        borderRadius: 10,
        border: `1px solid ${isCurrent ? "var(--accent)" : "var(--glass-border)"}`,
        background: "var(--surface-0)",
        overflow: "hidden",
        boxShadow: isCurrent ? "0 0 12px var(--accent-glow)" : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {children}
      <button
        type="button"
        data-testid={`dive-use-${assetId}`}
        onClick={onUse}
        disabled={isCurrent}
        style={{
          position: "absolute",
          bottom: 6,
          left: 6,
          right: 6,
          padding: "3px 6px",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          border: "1px solid var(--accent)",
          background: isCurrent ? "var(--accent-glow)" : "rgba(0,0,0,0.55)",
          color: "var(--accent-hi)",
          borderRadius: 3,
          cursor: isCurrent ? "default" : "pointer",
          opacity: isCurrent ? 0.6 : 1,
        }}
      >
        {isCurrent ? "CURRENT" : `USE · ${assetId}`}
      </button>
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}
