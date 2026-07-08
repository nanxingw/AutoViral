import { Handle, Position, type Node } from "@xyflow/react";
import { useState, type CSSProperties, type ReactNode } from "react";
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
  /** Item 4 — entrance-animation window timestamp + stagger index (unassigned
   *  members animate in when the bucket is expanded; undefined = no entrance). */
  enterTs?: number;
  enterIndex?: number;
  onUse: () => void;
}

export type DiveNode = Node<DiveNodeData>;

export interface NodeShellProps {
  assetId: string;
  isCurrent: boolean;
  isSelectedTake?: boolean;
  /** Item 2 — the media IS the subject: no idle border/fill, only an accent
   *  ring on current / selected-take / hover. audio & text leave this false so
   *  they keep a frame (nothing to fill the card). */
  frameless?: boolean;
  /** Item 5 — asset still generating: hide the USE pill + bottom scrim (there is
   *  no take to use yet; the GeneratingOverlay owns the fill). */
  busy?: boolean;
  /** Item 4 — see DiveNodeData.enterTs. */
  enterTs?: number;
  enterIndex?: number;
  onUse: () => void;
  children: ReactNode;
}

/** Item 4 — how long after an expand a newly-mounted node still plays its
 *  entrance. Short so onlyRenderVisibleElements remounts (pan/zoom) that happen
 *  later never replay it as flicker. */
const ENTER_WINDOW_MS = 800;

function useEntrance(enterTs?: number, enterIndex = 0): CSSProperties | undefined {
  // Decide ONCE at mount: an entrance only plays for a node mounted inside the
  // window right after a user-driven expand — never on later pan/zoom remounts,
  // and never under prefers-reduced-motion. useState initialiser freezes it so a
  // re-render can't retrigger it.
  const [entering] = useState(() => {
    if (enterTs == null || enterTs <= 0) return false;
    if (Date.now() - enterTs >= ENTER_WINDOW_MS) return false;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return false;
    }
    return true;
  });
  if (!entering) return undefined;
  return {
    animation: "dive-child-in 340ms cubic-bezier(0.2, 0.85, 0.18, 1) both",
    animationDelay: `${45 + enterIndex * 24}ms`,
  };
}

export function NodeShell({
  assetId,
  isCurrent,
  isSelectedTake = false,
  frameless = false,
  busy = false,
  enterTs,
  enterIndex = 0,
  onUse,
  children,
}: NodeShellProps) {
  const t = useT();
  const entrance = useEntrance(enterTs, enterIndex);
  // Currently-bound (isCurrent) wins the accent border; a selected take that
  // isn't the bound clip still gets a distinct ring so "chosen take" reads at
  // a glance on the clustered canvas. A frameless (media) node has NO idle
  // border — the image is the subject; the accent ring only appears on
  // current / selected / hover (hover lives in dive.css via data-frameless).
  const borderColor = isCurrent
    ? "var(--accent)"
    : isSelectedTake
      ? "var(--accent-hi)"
      : frameless
        ? "transparent"
        : "var(--canvas-border)";
  const boxShadow = isCurrent
    ? "0 0 12px var(--accent-glow)"
    : isSelectedTake
      ? "0 0 0 2px var(--accent-hi)"
      : "none";
  return (
    <div
      data-testid={`dive-node-${assetId}`}
      data-selected-take={isSelectedTake ? "true" : undefined}
      data-frameless={frameless ? "true" : undefined}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        position: "relative",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${borderColor}`,
        background: frameless ? "transparent" : "var(--canvas-surface-hi)",
        overflow: "hidden",
        boxShadow,
        transition: "border-color 0.15s, box-shadow 0.15s",
        // Performance guard — a node is a self-contained layout/paint subtree, so
        // one node's re-layout can't reflow its neighbours on a dense canvas.
        contain: "layout",
        ...entrance,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {children}
      {/* Bottom scrim so the USE pill stays legible over bright thumbnails
          without boxing the whole card. Hidden while generating (no pill). */}
      {!busy && (
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
      )}
      {!busy && (
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
          border: `1px solid ${isCurrent ? "var(--accent)" : "var(--canvas-border)"}`,
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
      )}
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}
