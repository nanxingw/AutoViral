import { Handle, Position, type Node } from "@xyflow/react";
import type { ReactNode } from "react";
import type { AssetEntry } from "../../types";
import { useT } from "@/i18n/useT";
import { HIT_TARGET_CLASS, HIT_TARGET_STYLE } from "./hitTarget";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 120;

export interface DiveNodeData extends Record<string, unknown> {
  asset: AssetEntry;
  isCurrent: boolean;
  /** B5 — this asset is the scene's selected take (scene.selectedAssetId). */
  isSelectedTake?: boolean;
  onUse: () => void;
}

export type DiveNode = Node<DiveNodeData>;

export interface NodeShellProps {
  assetId: string;
  isCurrent: boolean;
  isSelectedTake?: boolean;
  onUse: () => void;
  children: ReactNode;
}

export function NodeShell({
  assetId,
  isCurrent,
  isSelectedTake = false,
  onUse,
  children,
}: NodeShellProps) {
  const t = useT();
  // Currently-bound (isCurrent) wins the accent border; a selected take that
  // isn't the bound clip still gets a distinct ring so "chosen take" reads at
  // a glance on the clustered canvas.
  const borderColor = isCurrent
    ? "var(--accent)"
    : isSelectedTake
      ? "var(--accent-hi)"
      : "var(--glass-border)";
  const boxShadow = isCurrent
    ? "0 0 12px var(--accent-glow)"
    : isSelectedTake
      ? "0 0 0 2px var(--accent-hi)"
      : "none";
  return (
    <div
      data-testid={`dive-node-${assetId}`}
      data-selected-take={isSelectedTake ? "true" : undefined}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        position: "relative",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${borderColor}`,
        background: "var(--surface-1)",
        overflow: "hidden",
        boxShadow,
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {children}
      {/* Bottom scrim so the USE pill stays legible over bright thumbnails
          without boxing the whole card. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 44,
          background: "linear-gradient(180deg, transparent, rgba(10,11,15,0.72))",
          pointerEvents: "none",
        }}
      />
      <button
        type="button"
        data-testid={`dive-use-${assetId}`}
        className={HIT_TARGET_CLASS}
        onClick={onUse}
        disabled={isCurrent}
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          padding: "4px 8px",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          border: `1px solid ${isCurrent ? "var(--accent)" : "var(--glass-hi)"}`,
          background: isCurrent ? "var(--accent-glow)" : "rgba(10,11,15,0.6)",
          color: isCurrent ? "var(--accent-hi)" : "var(--text-dim)",
          borderRadius: 999,
          cursor: isCurrent ? "default" : "pointer",
          transition: "border-color 0.15s, color 0.15s, background 0.15s",
          // A dive node can be non-interactive (pointer-events:none, no nopan
          // wrapper); the USE button must re-open itself + opt out of pan/drag so
          // a real click selects the take instead of panning the canvas. Self-
          // sufficient regardless of the enclosing node's draggable flag.
          // (See ./hitTarget — E2E R2 BE2-画布聚簇-F1.)
          ...HIT_TARGET_STYLE,
        }}
      >
        {isCurrent ? "CURRENT" : t("studio.diveCanvas.btnUse", { id: assetId })}
      </button>
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}
