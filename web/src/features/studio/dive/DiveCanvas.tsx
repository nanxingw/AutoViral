import { useEffect, useMemo, useRef, type ReactNode } from "react";
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
import { computeClusterLayout, CLUSTER_HEADER } from "./clusterLayout";
import { computeTreeLayout } from "./useTreeLayout";
import { useDive } from "./diveStore";
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
  // B6 — canvas chrome state (view toggle + unassigned fold + cluster-title
  // jump) lives in the shared diveStore so the top bar can open the canvas and
  // a cluster title can hand the sidebar a jump target.
  const view = useDive((s) => s.view);
  const unassignedCollapsed = useDive((s) => s.unassignedCollapsed);
  const setView = useDive((s) => s.setView);
  const jumpToScene = useDive((s) => s.jumpToScene);
  const toggleUnassignedCollapsed = useDive((s) => s.toggleUnassignedCollapsed);
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

  // Build ReactFlow nodes + edges for the active view (B6):
  //   • "scene"   — SCENE-CLUSTERED compound graph (B5): each 分镜 is a group
  //     node with member child nodes. The unassigned bucket folds away by
  //     default (unless it's the ONLY cluster — collapsing it would blank the
  //     canvas). Cluster titles carry a jump-to-storyboard callback.
  //   • "lineage" — the flat provenance DAG (the pre-cluster view, preserved):
  //     every asset is a top-level node laid out by derivation edges.
  // Provenance edges are rendered in both views; edges touching a hidden
  // (folded-away) node are dropped so xyflow never dangles them.
  const { nodes, edges } = useMemo(() => {
    if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
    const assetById = new Map(comp.assets.map((a) => [a.id, a] as const));
    const layoutInputEdges = comp.provenance
      .filter((e) => e.fromAssetId != null)
      .map((e) => ({ source: e.fromAssetId as string, target: e.toAssetId }));

    const makeChildData = (asset: AssetEntry, isSelectedTake: boolean) => ({
      // Override asset.uri with the http-served URL so the <img>/<video> tag
      // can actually load (workspace-relative + shared-asset paths translated).
      asset: { ...asset, uri: resolveAssetUrl(asset.uri, comp.workId) },
      isCurrent: asset.id === currentAssetId,
      isSelectedTake,
      onUse: () => {
        if (selection) rebindClip(selection, asset.id);
      },
    });

    // ── Lineage view: flat provenance DAG (no group nodes) ──────────────────
    if (view === "lineage") {
      const layoutNodes = comp.assets.map((a) => ({
        id: a.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }));
      const pos = computeTreeLayout(layoutNodes, layoutInputEdges);
      const flatNodes: Node[] = comp.assets.map((asset) => ({
        id: asset.id,
        type: kindToNodeType(asset),
        position: pos.get(asset.id) ?? { x: 0, y: 0 },
        data: makeChildData(asset, false),
      }));
      const flowEdges: Edge[] = layoutInputEdges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
      }));
      return { nodes: flatNodes, edges: flowEdges };
    }

    // ── Scene view: clustered compound graph ────────────────────────────────
    const clusters = computeSceneClusters(comp);
    const hasSceneClusters = clusters.some((c) => !c.isUnassigned);
    const { groups, children } = computeClusterLayout(
      clusters,
      layoutInputEdges,
      NODE_WIDTH,
      NODE_HEIGHT,
    );
    // The unassigned bucket only collapses when there's something else to look
    // at — a work with no scenes has ONLY the unassigned cluster, so folding it
    // would leave the canvas empty.
    const isFolded = (cluster: (typeof clusters)[number]) =>
      cluster.isUnassigned && unassignedCollapsed && hasSceneClusters;

    // Group (parent) nodes MUST precede their children in the array (xyflow).
    const groupNodes: Node[] = clusters.map((cluster) => {
      const box = groups.get(cluster.id)!;
      const title = cluster.scene?.title?.trim();
      const label =
        title || (cluster.isUnassigned ? t("studio.diveCanvas.unassigned") : cluster.id);
      const folded = isFolded(cluster);
      return {
        id: cluster.id,
        type: "sceneGroup",
        position: box.position,
        data: {
          label,
          isUnassigned: cluster.isUnassigned,
          scene: cluster.scene,
          shotNo: cluster.scene ? cluster.scene.order + 1 : null,
          onJump: cluster.sceneId
            ? () => jumpToScene(cluster.sceneId as string)
            : undefined,
          collapsed: folded,
          memberCount: cluster.assetIds.length,
          onToggleCollapse: cluster.isUnassigned
            ? toggleUnassignedCollapsed
            : undefined,
        },
        // A folded bucket shrinks to just its header bar.
        style: { width: box.width, height: folded ? CLUSTER_HEADER : box.height },
        selectable: false,
        draggable: false,
      };
    });

    const childNodes: Node[] = [];
    const renderedIds = new Set<string>();
    for (const cluster of clusters) {
      if (isFolded(cluster)) continue; // hide a folded bucket's members
      for (const assetId of cluster.assetIds) {
        const asset = assetById.get(assetId);
        if (!asset) continue;
        const placement = children.get(assetId)!;
        renderedIds.add(asset.id);
        childNodes.push({
          id: asset.id,
          type: kindToNodeType(asset),
          parentId: cluster.id,
          extent: "parent",
          position: placement.position,
          data: makeChildData(asset, cluster.selectedAssetId === asset.id),
        });
      }
    }

    // Drop edges whose endpoints are hidden inside a folded bucket.
    const flowEdges: Edge[] = layoutInputEdges
      .filter((e) => renderedIds.has(e.source) && renderedIds.has(e.target))
      .map((e) => ({ id: `${e.source}->${e.target}`, source: e.source, target: e.target }));
    return { nodes: [...groupNodes, ...childNodes], edges: flowEdges };
  }, [
    comp,
    currentAssetId,
    selection,
    rebindClip,
    t,
    view,
    unassignedCollapsed,
    jumpToScene,
    toggleUnassignedCollapsed,
  ]);

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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* B6 — 按分镜聚簇 / 按衍生链 view toggle. */}
            <div
              role="group"
              aria-label={t("studio.diveCanvas.viewToggleAria")}
              style={{
                display: "inline-flex",
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <ViewToggleButton
                active={view === "scene"}
                testid="dive-view-scene"
                onClick={() => setView("scene")}
              >
                {t("studio.diveCanvas.viewScene")}
              </ViewToggleButton>
              <ViewToggleButton
                active={view === "lineage"}
                testid="dive-view-lineage"
                onClick={() => setView("lineage")}
              >
                {t("studio.diveCanvas.viewLineage")}
              </ViewToggleButton>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" data-bare>
              ×
            </button>
          </div>
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

function ViewToggleButton({
  active,
  testid,
  onClick,
  children,
}: {
  active: boolean;
  testid: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-bare
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: "5px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        border: "none",
        background: active ? "var(--surface-1)" : "transparent",
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
