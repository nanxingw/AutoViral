import type { Node, NodeProps } from "@xyflow/react";
import type { Scene } from "@shared/composition";
import { useT } from "@/i18n/useT";
import { STATUS_KEY, INTENT_KEY, SHOT_KEY, STATUS_FILLED } from "../../sceneI18n";

// B6 (PRD-0010) — the container behind a scene cluster, now carrying a rich
// title bar: 镜号 · title · intent · shot · status. The status/intent/shot copy
// comes from the SAME sceneI18n maps the ScriptTab storyboard list uses ("同
// 源"). The "需重生 / stale" state is MULTI-ENCODED — colour (--status-warn) +
// icon (⚠) + text badge — never colour alone (e2e Hard rule 5). Clicking a
// scene title jumps back to its storyboard card; the unassigned bucket instead
// shows a fold toggle (its members default collapsed to reduce canvas noise).

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
        borderRadius: 14,
        border: `1px ${isUnassigned ? "dashed" : "solid"} var(--glass-border)`,
        background: isUnassigned
          ? "rgba(255,255,255,0.015)"
          : "rgba(255,255,255,0.03)",
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
      onClick={onJump}
      aria-label={t("studio.diveCanvas.jumpToSceneAria", { n: shotNo ?? 0 })}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "9px 12px",
        background: "transparent",
        border: "none",
        borderRadius: "14px 14px 0 0",
        cursor: "pointer",
        textAlign: "left",
        minWidth: 0,
        // xyflow stamps `pointer-events: none` on this node's `.react-flow__node`
        // wrapper (group nodes are selectable:false/draggable:false); re-open the
        // button as a hit target so a REAL mouse click reaches onJump instead of
        // falling through to the react-flow__pane. (E2E R2 BE2-画布聚簇-F1.)
        pointerEvents: "auto",
      }}
    >
      {/* 镜号 */}
      {shotNo != null && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-dimmer)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {t("studio.scriptPanel.shotNumber", { n: shotNo })}
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
      aria-expanded={!collapsed}
      onClick={onToggleCollapse}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "9px 12px",
        background: "transparent",
        border: "none",
        borderRadius: "14px 14px 0 0",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-dimmer)",
        // Same escape hatch as the scene title: the unassigned group node's
        // `.react-flow__node` wrapper is pointer-events:none, so the fold toggle
        // must re-open itself as a hit target. (E2E R2 BE2-画布聚簇-F1.)
        pointerEvents: "auto",
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
