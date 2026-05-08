import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComposition } from "../store";
import type { AssetEntry, Clip } from "../types";
import { findAssetByUri } from "./walkProvenance";
import { computeTreeLayout } from "./useTreeLayout";
import { NODE_WIDTH, NODE_HEIGHT } from "./nodes/NodeShell";
import { VisualNode } from "./nodes/VisualNode";
import { AudioNode } from "./nodes/AudioNode";
import { TextNode } from "./nodes/TextNode";
import { useT } from "@/i18n/useT";

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
  const t = useT();

  // Find the selected clip's currently-bound asset, if any.
  const currentAssetId = useMemo<string | null>(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c && c.kind !== "text") return findAssetByUri(comp, c.src)?.id ?? null;
    }
    return null;
  }, [comp, selection]);

  // Build ReactFlow nodes + edges from comp.assets / comp.provenance.
  // Layout is computed by Dagre via `computeTreeLayout` (LR rankdir).
  const { nodes, edges } = useMemo(() => {
    if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
    const assets = comp.assets;
    const provenance = comp.provenance;

    const layoutInputNodes = assets.map((a) => ({ id: a.id, width: NODE_WIDTH, height: NODE_HEIGHT }));
    const layoutInputEdges = provenance
      .filter((e) => e.fromAssetId != null)
      .map((e) => ({ source: e.fromAssetId as string, target: e.toAssetId }));
    const positions = computeTreeLayout(layoutInputNodes, layoutInputEdges);

    const flowNodes: Node[] = assets.map((asset) => ({
      id: asset.id,
      type: kindToNodeType(asset),
      position: positions.get(asset.id)!,
      data: {
        asset,
        isCurrent: asset.id === currentAssetId,
        onUse: () => {
          if (selection) rebindClip(selection, asset.id);
        },
      },
    }));
    const flowEdges: Edge[] = layoutInputEdges.map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
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

  const empty = !comp || comp.assets.length === 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dive-backdrop"
          data-testid="dive-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
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
          <motion.div
            // Stop click-through so internal canvas clicks don't dismiss.
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dive-title"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
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
            {t("studio.diveCanvas.title")}
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
              {t("studio.diveCanvas.empty")}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function kindToNodeType(asset: AssetEntry): "visual" | "audio" | "text" {
  if (asset.kind === "image" || asset.kind === "video") return "visual";
  if (asset.kind === "audio") return "audio";
  return "text"; // subtitle
}
