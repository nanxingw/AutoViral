import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { useComposition } from "../store";
import type { AssetEntry, Clip } from "../types";
import { findAssetByUri } from "./walkProvenance";
import { VisualNode } from "./nodes/VisualNode";
import { AudioNode } from "./nodes/AudioNode";
import { TextNode } from "./nodes/TextNode";

interface Props {
  open: boolean;
  onClose: () => void;
}

const nodeTypes = {
  visual: VisualNode,
  audio: AudioNode,
  text: TextNode,
};

export function DiveCanvas({ open, onClose }: Props) {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const rebindClip = useComposition((s) => s.rebindClip);

  // Find the selected clip's currently-bound asset, if any.
  const currentAssetId = useMemo<string | null>(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c && "src" in c) return findAssetByUri(comp, c.src)?.id ?? null;
    }
    return null;
  }, [comp, selection]);

  // Build ReactFlow nodes + edges from comp.assets / comp.provenance.
  // Layout x/y here is a quick column-grid placeholder; Phase 5.D replaces
  // this with Dagre via useTreeLayout.
  const { nodes, edges } = useMemo(() => {
    if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
    const assets = comp.assets;
    const provenance = comp.provenance;
    const flowNodes: Node[] = assets.map((asset, i) => ({
      id: asset.id,
      type: kindToNodeType(asset),
      position: { x: i * 240, y: 0 }, // placeholder layout — replaced in 5.D
      data: {
        asset,
        isCurrent: asset.id === currentAssetId,
        onUse: () => {
          if (selection) rebindClip(selection, asset.id);
        },
      },
    }));
    const flowEdges: Edge[] = provenance
      .filter((e) => e.fromAssetId != null)
      .map((e) => ({
        id: `${e.fromAssetId}->${e.toAssetId}`,
        source: e.fromAssetId as string,
        target: e.toAssetId,
      }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [comp, currentAssetId, selection, rebindClip]);

  // ESC handler
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const empty = !comp || comp.assets.length === 0;

  return createPortal(
    <div
      data-testid="dive-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 11, 15, 0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "grid",
        placeItems: "stretch",
      }}
    >
      <div
        // Stop click-through so internal canvas clicks don't dismiss.
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dive-title"
        style={{
          position: "absolute",
          inset: 40,
          borderRadius: 16,
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--divider)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            id="dive-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-editorial)",
              fontStyle: "italic",
              fontSize: 22,
              letterSpacing: "-0.015em",
              color: "var(--text)",
            }}
          >
            Provenance Dive
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" data-bare>
            ×
          </button>
        </header>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {empty ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "var(--text-dimmer)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              No assets yet — generate or upload some, then come back.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function kindToNodeType(asset: AssetEntry): "visual" | "audio" | "text" {
  if (asset.kind === "image" || asset.kind === "video") return "visual";
  if (asset.kind === "audio") return "audio";
  return "text"; // subtitle
}
