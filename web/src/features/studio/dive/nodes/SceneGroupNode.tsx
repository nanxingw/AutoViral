import type { Node, NodeProps } from "@xyflow/react";
import type { Scene } from "@shared/composition";
import { useT } from "@/i18n/useT";
import { STATUS_KEY, INTENT_KEY, SHOT_KEY, STATUS_FILLED } from "../../sceneI18n";
import { HIT_TARGET_CLASS, HIT_TARGET_STYLE } from "./hitTarget";

// B6 (PRD-0010) — the container behind a scene cluster, now carrying a rich
// title bar: 镜号 · title · intent · shot · status. The status/intent/shot copy
// comes from the SAME sceneI18n maps the ScriptTab storyboard list uses ("同
// 源"). The "需重生 / stale" state is MULTI-ENCODED — colour (--status-warn) +
// icon (⚠) + text badge — never colour alone (e2e Hard rule 5). Clicking a
// scene title jumps back to its storyboard card; the unassigned bucket instead
// shows a fold toggle (its members default collapsed to reduce canvas noise).

// ── Interaction model ────────────────────────────────────────────────────────
// A scene-cluster group node is handed to xyflow with `selectable:false,
// draggable:false` and NO node-level mouse handler (DiveCanvas). xyflow's
// NodeWrapper then computes `hasPointerEvents = isSelectable || isDraggable ||
// onClick || onMouseEnter|Move|Leave === false` and stamps `pointer-events:none`
// INLINE on the `.react-flow__node` wrapper — every descendant inherits it, so a
// REAL mouse click on an inner control falls straight through to the
// react-flow__pane (z=1) and does nothing (fireEvent.click bypasses hit-testing,
// which is why handler unit tests still pass — see the real-ReactFlow contract
// test in SceneGroupNode.test.tsx).
//
// The model we WANT is: the non-interactive box background stays pass-through (so
// dragging an empty part of a cluster still pans the canvas), while each genuinely
// interactive control re-opens itself as a hit target AND opts out of the pane's
// pan/drag so its pointerdown isn't hijacked into a canvas pan that swallows the
// click. Hoisting this to the whole group container would trap those background
// pans, so instead every interactive control inside a group node spreads
// HIT_TARGET_STYLE + HIT_TARGET_CLASS (see ./hitTarget for the two-mechanism
// rationale). Any control added here in the future must do the same.
// (E2E R2 BE2-画布聚簇-F1.)

export interface SceneGroupNodeData extends Record<string, unknown> {
  isUnassigned: boolean;
  /** Fallback label — the unassigned bucket name, or a scene with no title. */
  label: string;
  /** Source scene (null for the unassigned bucket). */
  scene: Scene | null;
  /** scene.order + 1 (null for unassigned). */
  shotNo: number | null;
  /** Scene cluster only — jump to this scene's storyboard card. */
  onJump?: () => void;
  /** Unassigned only — whether the bucket's members are folded away. */
  collapsed?: boolean;
  /** Unassigned only — how many members are hidden while collapsed. */
  memberCount?: number;
  /** Unassigned only — toggle the fold. */
  onToggleCollapse?: () => void;
}

export type SceneGroupNode = Node<SceneGroupNodeData>;

export function SceneGroupNode({ id, data }: NodeProps<SceneGroupNode>) {
  const t = useT();
  const { isUnassigned, scene } = data;

  return (
    <div
      data-testid={`dive-cluster-${id}`}
      data-unassigned={isUnassigned ? "true" : undefined}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "var(--radius-lg)",
        border: `1px ${isUnassigned ? "dashed" : "solid"} var(--glass-border)`,
        // Solid-ish tinted fill (NO backdrop-filter inside the canvas — see
        // DESIGN.md "Glass with discipline"); the faint top-down falloff keeps
        // the title bar reading as the cluster's chrome.
        background: isUnassigned
          ? "var(--surface-0)"
          : "linear-gradient(180deg, var(--surface-1), var(--surface-0) 96px)",
        boxShadow: "inset 0 1px 0 var(--glass-hi)",
        boxSizing: "border-box",
      }}
    >
      {isUnassigned ? (
        <UnassignedHeader
          label={data.label}
          collapsed={data.collapsed ?? false}
          memberCount={data.memberCount ?? 0}
          onToggleCollapse={data.onToggleCollapse}
        />
      ) : (
        <SceneHeader scene={scene} shotNo={data.shotNo} label={data.label} onJump={data.onJump} t={t} />
      )}
    </div>
  );
}

function SceneHeader({
  scene,
  shotNo,
  label,
  onJump,
  t,
}: {
  scene: Scene | null;
  shotNo: number | null;
  label: string;
  onJump?: () => void;
  t: ReturnType<typeof useT>;
}) {
  // A scene cluster always has a scene; guard defensively so a malformed node
  // can't crash the whole canvas.
  const status = scene?.status ?? "planned";
  const isStale = status === "stale";
  const statusLabel = t(STATUS_KEY[status]);
  const statusColor = isStale ? "var(--status-warn, #fbbf24)" : "var(--accent)";
  const title = scene?.title?.trim() || label;
  const intentLabel = scene?.intent ? t(INTENT_KEY[scene.intent]) : "—";
  const shotLabel = scene?.shotSize ? t(SHOT_KEY[scene.shotSize]) : "—";

  return (
    <button
      type="button"
      data-testid="dive-cluster-title"
      className={HIT_TARGET_CLASS}
      onClick={onJump}
      aria-label={t("studio.diveCanvas.jumpToSceneAria", { n: shotNo ?? 0 })}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 44, // == clusterLayout.CLUSTER_HEADER
        padding: "0 12px",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--divider)",
        borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
        cursor: "pointer",
        textAlign: "left",
        minWidth: 0,
        boxSizing: "border-box",
        // Re-open this control as a hit target + opt out of pane pan/drag under
        // the group node's pointer-events:none, nopan-less wrapper (see
        // ./hitTarget for why both halves are required).
        ...HIT_TARGET_STYLE,
      }}
    >
      {/* 镜号 — the one place product UI wears the editorial serif: a numeric
          badge (CLAUDE.md "Instrument Serif italic · 数字徽章"). Semantics for
          screen readers live on the button's jumpToSceneAria label. */}
      {shotNo != null && (
        <span
          data-testid="dive-cluster-shotno"
          aria-hidden
          style={{
            fontFamily: "var(--font-editorial)",
            fontStyle: "italic",
            fontSize: 19,
            lineHeight: 1,
            color: "var(--accent)",
            whiteSpace: "nowrap",
            flexShrink: 0,
            minWidth: 24,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {String(shotNo).padStart(2, "0")}
        </span>
      )}
      {/* status dot — filled (generated/stale) or hollow (planned); state also
          carried on data-status so it survives greyscale. */}
      <span
        data-testid="dive-cluster-status-dot"
        data-status={status}
        role="img"
        aria-label={statusLabel}
        title={statusLabel}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: STATUS_FILLED[status] ? statusColor : "transparent",
          border: `1.5px solid ${statusColor}`,
        }}
      />
      {/* stale badge — TEXT + ICON + colour, never colour alone. */}
      {isStale && (
        <span
          data-testid="dive-cluster-stale"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--status-warn, #fbbf24)",
            border: "1px solid var(--status-warn, #fbbf24)",
            borderRadius: 4,
            padding: "0 4px",
            whiteSpace: "nowrap",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <span aria-hidden>⚠</span>
          {t("studio.scriptPanel.staleBadge")}
        </span>
      )}
      {/* title */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        {title}
      </span>
      {/* meta — status / intent / shot, single-sourced from sceneI18n. */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.03em",
          color: "var(--text-dimmer)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span data-testid="dive-cluster-status">{statusLabel}</span>
        <span data-testid="dive-cluster-intent">{intentLabel}</span>
        <span data-testid="dive-cluster-shot">{shotLabel}</span>
      </span>
    </button>
  );
}

function UnassignedHeader({
  label,
  collapsed,
  memberCount,
  onToggleCollapse,
}: {
  label: string;
  collapsed: boolean;
  memberCount: number;
  onToggleCollapse?: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="dive-unassigned-toggle"
      className={HIT_TARGET_CLASS}
      aria-expanded={!collapsed}
      onClick={onToggleCollapse}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 44, // == clusterLayout.CLUSTER_HEADER
        padding: "0 12px",
        background: "transparent",
        border: "none",
        borderBottom: collapsed ? "none" : "1px solid var(--divider)",
        borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
        cursor: "pointer",
        textAlign: "left",
        boxSizing: "border-box",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-dimmer)",
        // Same escape hatch as the scene title (see ./hitTarget above).
        ...HIT_TARGET_STYLE,
      }}
    >
      <span aria-hidden style={{ fontSize: 9 }}>
        {collapsed ? "▸" : "▾"}
      </span>
      <span>{label}</span>
      <span
        style={{
          marginLeft: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--glass-border)",
          borderRadius: 999,
          padding: "0 7px",
          fontSize: 10,
        }}
      >
        {collapsed
          ? t("studio.diveCanvas.expandUnassigned", { n: memberCount })
          : t("studio.diveCanvas.collapseUnassigned")}
      </span>
    </button>
  );
}
