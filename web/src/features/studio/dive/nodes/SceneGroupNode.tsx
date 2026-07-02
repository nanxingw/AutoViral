import type { Node, NodeProps } from "@xyflow/react";

// B5 (PRD-0010) — the container behind a scene cluster. Renders a bordered
// box with a title bar; xyflow layers the member (child) nodes on top inside
// its coordinate space. Kept intentionally minimal — the rich title chrome
// (镜号 / 意图 / 景别 / 状态 + jump-to-scene) is B6's job. Here we only draw
// the frame + the scene title so the clustering is legible.

export interface SceneGroupNodeData extends Record<string, unknown> {
  label: string;
  isUnassigned: boolean;
}

export type SceneGroupNode = Node<SceneGroupNodeData>;

export function SceneGroupNode({ id, data }: NodeProps<SceneGroupNode>) {
  return (
    <div
      data-testid={`dive-cluster-${id}`}
      data-unassigned={data.isUnassigned ? "true" : undefined}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 14,
        border: `1px ${data.isUnassigned ? "dashed" : "solid"} var(--glass-border)`,
        background: data.isUnassigned
          ? "rgba(255,255,255,0.015)"
          : "rgba(255,255,255,0.03)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: data.isUnassigned ? "var(--text-dimmer)" : "var(--text-dim)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.label}
      </div>
    </div>
  );
}
