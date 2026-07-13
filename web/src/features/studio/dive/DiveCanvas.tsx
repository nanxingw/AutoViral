import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  MarkerType,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./dive.css";
import { useComposition } from "../store";
import type { AssetEntry, Clip } from "../types";
import { findAssetByUri } from "./walkProvenance";
import { resolveAssetUrl } from "../composition/resolveAssetUrl";
import { computeSceneClusters } from "./useSceneClusters";
import {
  computeClusterLayout,
  CLUSTER_FOLDED_WIDTH,
  CLUSTER_FOLDED_HEIGHT,
} from "./clusterLayout";
import { computeTreeLayout } from "./useTreeLayout";
import { useDive } from "./diveStore";
import { NODE_WIDTH, NODE_HEIGHT } from "./nodes/NodeShell";
import { VisualNode } from "./nodes/VisualNode";
import { AudioNode } from "./nodes/AudioNode";
import { TextNode } from "./nodes/TextNode";
import { SceneGroupNode } from "./nodes/SceneGroupNode";
import { DiveEdge } from "./nodes/DiveEdge";
import { miniMapNodeColor } from "./miniMapColor";
import { useT } from "@/i18n/useT";
import { IconButton } from "@/ui/IconButton";
import { XIcon } from "@/ui/icons";

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

// Item 3 — provenance edges use the custom three-piece DiveEdge (bezier + wide
// hit path + hover/selected glow + optional marching-ants).
const edgeTypes = {
  dive: DiveEdge,
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
  const lastExpandAt = useDive((s) => s.lastExpandAt);
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

    const makeChildData = (
      asset: AssetEntry,
      isSelectedTake: boolean,
      enter?: { ts: number; index: number },
    ) => ({
      // Override asset.uri with the http-served URL so the <img>/<video> tag
      // can actually load (workspace-relative + shared-asset paths translated).
      asset: { ...asset, uri: resolveAssetUrl(asset.uri, comp.workId) },
      isCurrent: asset.id === currentAssetId,
      isSelectedTake,
      // Item 4 — entrance window + stagger index (unassigned members only).
      enterTs: enter?.ts,
      enterIndex: enter?.index,
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
        // 画布-F2 — the MiniMap draws a rect per node ONLY when the user node
        // carries a dimension (measured?.w ?? width ?? initialWidth). We hand
        // ReactFlow a controlled `nodes` prop with no onNodesChange, so the
        // dims xyflow measures land on the internal nodeLookup (bounds stay
        // correct) but never flow back onto the user node — leaving the minimap
        // with dimensionless nodes and zero rects. Seed the fixed NodeShell size
        // as an initial dimension so the minimap sizes each rect immediately.
        initialWidth: NODE_WIDTH,
        initialHeight: NODE_HEIGHT,
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
      // Item 1 — a folded bucket renders a poker-fan preview: the first member's
      // resolved thumbnail as the top card + the member count.
      let stackPreview:
        | { asset: { id: string; kind: AssetEntry["kind"]; uri: string; name?: string }; count: number }
        | undefined;
      if (folded && cluster.assetIds.length > 0) {
        const firstAsset = assetById.get(cluster.assetIds[0]);
        if (firstAsset) {
          stackPreview = {
            asset: {
              id: firstAsset.id,
              kind: firstAsset.kind,
              uri: resolveAssetUrl(firstAsset.uri, comp.workId),
              name: firstAsset.name,
            },
            count: cluster.assetIds.length,
          };
        }
      }
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
          stackPreview,
        },
        // 画布-F2 — feed the minimap an initial dimension (see the flat-node
        // note above): a controlled node's measured size never reaches the user
        // node, so without this the group draws no minimap rect.
        initialWidth: folded ? CLUSTER_FOLDED_WIDTH : box.width,
        initialHeight: folded ? CLUSTER_FOLDED_HEIGHT : box.height,
        // A folded bucket shrinks to a compact card-sized box holding the fan.
        style: {
          width: folded ? CLUSTER_FOLDED_WIDTH : box.width,
          height: folded ? CLUSTER_FOLDED_HEIGHT : box.height,
        },
        selectable: false,
        draggable: false,
      };
    });

    const childNodes: Node[] = [];
    const renderedIds = new Set<string>();
    for (const cluster of clusters) {
      if (isFolded(cluster)) continue; // hide a folded bucket's members
      // Item 4 — only the unassigned bucket folds/expands, so only its members
      // play the staggered entrance (scene clusters are always on-screen and
      // must not replay it on every pan/zoom remount).
      let memberIdx = 0;
      for (const assetId of cluster.assetIds) {
        const asset = assetById.get(assetId);
        if (!asset) continue;
        const placement = children.get(assetId)!;
        renderedIds.add(asset.id);
        const enter =
          cluster.isUnassigned && lastExpandAt > 0
            ? { ts: lastExpandAt, index: memberIdx }
            : undefined;
        childNodes.push({
          id: asset.id,
          type: kindToNodeType(asset),
          parentId: cluster.id,
          extent: "parent",
          position: placement.position,
          // 画布-F2 — initial dimension so the minimap draws this child's rect
          // (see the flat-node note above for the controlled-node root cause).
          initialWidth: NODE_WIDTH,
          initialHeight: NODE_HEIGHT,
          data: makeChildData(asset, cluster.selectedAssetId === asset.id, enter),
        });
        memberIdx++;
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
    lastExpandAt,
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
              background: "var(--canvas-bg)",
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
            <IconButton onClick={onClose} aria-label={t("cost.close")}>
              <XIcon />
            </IconButton>
          </div>
        </header>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {empty ? (
            <div
              data-testid="dive-empty"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
              }}
            >
              <div style={{ textAlign: "center", maxWidth: 360 }}>
                <div
                  aria-hidden
                  style={{
                    fontFamily: "var(--font-editorial)",
                    fontStyle: "italic",
                    fontSize: 44,
                    lineHeight: 1,
                    color: "var(--text-dimmer)",
                    marginBottom: 14,
                  }}
                >
                  ∅
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-editorial)",
                    fontStyle: "italic",
                    fontSize: 20,
                    letterSpacing: "-0.01em",
                    color: "var(--text-dim)",
                    marginBottom: 8,
                  }}
                >
                  {t("studio.diveCanvas.emptyTitle")}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    lineHeight: 1.7,
                    color: "var(--text-dimmer)",
                  }}
                >
                  {t("studio.diveCanvas.empty")}
                </div>
              </div>
            </div>
          ) : (
            <ReactFlow
              className="dive-flow"
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              // The whole point of the canvas is seeing detail AND the whole
              // film: 4× in to read a thumbnail, 0.15× out to see every 分镜.
              minZoom={0.15}
              maxZoom={4}
              // Provenance direction (source → derivative) carries meaning; the
              // custom DiveEdge (Item 3) draws a bezier + wide hit path + glow.
              // The arrowhead marker COLOUR rides markerEnd (xyflow paints it as
              // an inline style that beats any stylesheet selector).
              defaultEdgeOptions={{
                type: "dive",
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 14,
                  height: 14,
                  // xyflow paints the marker color as an INLINE style on the
                  // <polyline>, which beats any stylesheet selector — the token
                  // must ride the marker itself (CSS var in inline style keeps
                  // it theme-reactive).
                  color: "var(--accent-lo)",
                },
              }}
              // B5 — cull off-screen nodes; a large clustered graph must not
              // mount every node (pairs with MediaThumb's IntersectionObserver
              // video-preload gate).
              onlyRenderVisibleElements
              proOptions={{ hideAttribution: true }}
            >
              <AdaptiveBackground />
              <MiniMap
                pannable
                zoomable
                // Item 6 — tint minimap nodes by type so the map reads as a
                // legend, not a grey blob. Tokens resolve theme-reactively.
                nodeColor={miniMapNodeColor}
                ariaLabel={t("studio.diveCanvas.title")}
              />
              <Panel position="bottom-left">
                <ZoomBar />
              </Panel>
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

/** Item 6 — the dot grid, but the dots shrink at very low zoom so a fully
 *  zoomed-out canvas (0.15×) reads as a whisper of texture rather than a heavy
 *  stipple. Isolated in its own component so reading `zoom` only re-renders THIS
 *  subtree on every viewport tick, not the whole canvas. */
function AdaptiveBackground() {
  const { zoom } = useViewport();
  return (
    <Background
      variant={BackgroundVariant.Dots}
      gap={28}
      size={zoom < 0.12 ? 0.8 : 1.5}
    />
  );
}

function kindToNodeType(asset: AssetEntry): "visual" | "audio" | "text" {
  if (asset.kind === "image" || asset.kind === "video") return "visual";
  if (asset.kind === "audio") return "audio";
  return "text"; // subtitle
}

/** Custom zoom chrome replacing the library-default white <Controls>. Lives
 *  inside <ReactFlow> (Panel), so the flow hooks are in context. The readout
 *  re-renders on every zoom tick, but the subtree is four small elements —
 *  cheaper than mispricing the whole canvas. */
function ZoomBar() {
  const t = useT();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="dive-zoombar" data-testid="dive-zoombar">
      <button
        type="button"
        data-bare
        data-testid="dive-zoom-out"
        aria-label={t("studio.diveCanvas.zoomOutAria")}
        onClick={() => zoomOut({ duration: 120 })}
      >
        −
      </button>
      <span className="dive-zoom-readout" data-testid="dive-zoom-readout" aria-live="off">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        data-bare
        data-testid="dive-zoom-in"
        aria-label={t("studio.diveCanvas.zoomInAria")}
        onClick={() => zoomIn({ duration: 120 })}
      >
        +
      </button>
      <span className="dive-zoombar-divider" aria-hidden />
      <button
        type="button"
        data-bare
        data-testid="dive-zoom-fit"
        className="dive-zoom-fit"
        aria-label={t("studio.diveCanvas.zoomFitAria")}
        onClick={() => fitView({ padding: 0.12, duration: 220 })}
      >
        {t("studio.diveCanvas.zoomFit")}
      </button>
    </div>
  );
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
        background: active ? "var(--canvas-surface-hi)" : "transparent",
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
