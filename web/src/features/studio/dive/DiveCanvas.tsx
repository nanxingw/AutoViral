import { useEffect, useMemo, useRef } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
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
import { resolveAssetUrl } from "../composition/resolveAssetUrl";
import { computeSceneClusters } from "./useSceneClusters";
import { computeClusterLayout } from "./clusterLayout";
import { NODE_WIDTH, NODE_HEIGHT } from "./nodes/NodeShell";
import { VisualNode } from "./nodes/VisualNode";
import { AudioNode } from "./nodes/AudioNode";
import { TextNode } from "./nodes/TextNode";
import { SceneGroupNode } from "./nodes/SceneGroupNode";
import { useT } from "@/i18n/useT";

interface Props {
  open: boolean;
  onClose: () => void;
}

const nodeTypes = {
  visual: VisualNode,
  audio: AudioNode,
  text: TextNode,
  sceneGroup: SceneGroupNode,
};

export function DiveCanvas({ open, onClose }: Props) {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const rebindClip = useComposition((s) => s.rebindClip);
  const t = useT();
  // R41: focus management for keyboard users. Dive canvas is a full-
  // screen overlay—focus needs to enter it on open + return on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);

  // Find the selected clip's currently-bound asset, if any.
  const currentAssetId = useMemo<string | null>(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c && c.kind !== "text") return findAssetByUri(comp, c.src)?.id ?? null;
    }
    return null;
  }, [comp, selection]);

  // Build ReactFlow nodes + edges as a SCENE-CLUSTERED compound graph (B5).
  // Each 分镜 becomes a group node; its member assets become child nodes
  // positioned relative to the group (xyflow parentId). Provenance edges are
  // still rendered so derivation lineage stays visible across clusters.
  const { nodes, edges } = useMemo(() => {
    if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
    const assetById = new Map(comp.assets.map((a) => [a.id, a] as const));

    const clusters = computeSceneClusters(comp);
    const layoutInputEdges = comp.provenance
      .filter((e) => e.fromAssetId != null)
      .map((e) => ({ source: e.fromAssetId as string, target: e.toAssetId }));
    const { groups, children } = computeClusterLayout(
      clusters,
      layoutInputEdges,
      NODE_WIDTH,
      NODE_HEIGHT,
    );

    // Group (parent) nodes MUST precede their children in the array (xyflow).
    const groupNodes: Node[] = clusters.map((cluster) => {
      const box = groups.get(cluster.id)!;
      const title = cluster.scene?.title?.trim();
      const label =
        title || (cluster.isUnassigned ? t("studio.diveCanvas.unassigned") : cluster.id);
      return {
        id: cluster.id,
        type: "sceneGroup",
        position: box.position,
        data: { label, isUnassigned: cluster.isUnassigned },
        style: { width: box.width, height: box.height },
        selectable: false,
        draggable: false,
      };
    });

    const childNodes: Node[] = [];
    for (const cluster of clusters) {
      for (const assetId of cluster.assetIds) {
        const asset = assetById.get(assetId);
        if (!asset) continue;
        const placement = children.get(assetId)!;
        childNodes.push({
          id: asset.id,
          type: kindToNodeType(asset),
          parentId: cluster.id,
          extent: "parent",
          position: placement.position,
          data: {
            // Override asset.uri with the http-served URL so the <img>/<video>
            // tag can actually load. Workspace-relative + shared-asset paths
            // get translated to /api/works/:id/assets/* and
            // /api/shared-assets/* respectively. (resolveAssetUrl)
            asset: { ...asset, uri: resolveAssetUrl(asset.uri, comp.workId) },
            isCurrent: asset.id === currentAssetId,
            isSelectedTake: cluster.selectedAssetId === asset.id,
            onUse: () => {
              if (selection) rebindClip(selection, asset.id);
            },
          },
        });
      }
    }

    const flowEdges: Edge[] = layoutInputEdges.map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
    }));
    return { nodes: [...groupNodes, ...childNodes], edges: flowEdges };
  }, [comp, currentAssetId, selection, rebindClip, t]);

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
            ref={dialogRef}
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
              // B5 — cull off-screen nodes; a large clustered graph must not
              // mount every node (pairs with MediaThumb's IntersectionObserver
              // video-preload gate).
              onlyRenderVisibleElements
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
