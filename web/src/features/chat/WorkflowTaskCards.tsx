import { useMemo } from "react";
import { useT, type MessageKey } from "@/i18n/useT";
import {
  useWorkflowTaskStore,
  panelTasksFor,
  taskKey,
  isTerminalStatus,
  type WorkflowTask,
  type WorkflowTaskStatus,
} from "./workflow-tasks.store";

/**
 * PRD-0015 S4 — the DURABLE task-card dock (not a 2s toast). Renders one card
 * per live background task + a short tail of recently-settled ones, so a
 * multi-agent Workflow the chat agent launched is visible: name, type, status,
 * and the "how much did it cost" usage line. Empty → renders nothing.
 *
 * Aesthetic: editorial · glass · restrained (CLAUDE.md Aesthetic Direction).
 * Glass surface, mono eyebrow/badges, one calm pulse dot for the running dot —
 * no high-saturation emotion stacking.
 */

/** Status → the visual family the chip uses. Terminal-ok is green, failure
 *  family is red, interrupted family (killed / stopped / orphaned) is amber. */
function statusColor(status: WorkflowTaskStatus): string {
  switch (status) {
    case "running":
    case "pending-settle":
      return "var(--accent)";
    case "completed":
      return "var(--status-ok, #6ec18f)";
    case "failed":
      return "var(--status-error, #d4756c)";
    case "killed":
    case "stopped":
    case "orphaned":
    default:
      return "var(--status-warn, #d0a54f)";
  }
}

function formatCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function WorkflowTaskCard({
  task,
  t,
}: {
  task: WorkflowTask;
  t: ReturnType<typeof useT>;
}) {
  const color = statusColor(task.status);
  const live = !isTerminalStatus(task.status);
  const statusLabel = t(`chat.workflow.status.${task.status}` as MessageKey);
  const name = task.description || t("chat.workflow.untitled");

  // Usage summary — the "how much did it cost" surface. Only the counts the
  // task actually reported, in a mono eyebrow.
  const usageParts: string[] = [];
  const u = task.usage;
  if (u) {
    if (typeof u.agents === "number" && u.agents > 0) {
      usageParts.push(t("chat.workflow.agents", { count: u.agents }));
    } else if (typeof u.tool_uses === "number" && u.tool_uses > 0) {
      usageParts.push(t("chat.workflow.toolUses", { count: u.tool_uses }));
    }
    if (typeof u.total_tokens === "number" && u.total_tokens > 0) {
      usageParts.push(t("chat.workflow.tokens", { count: formatCount(u.total_tokens) }));
    }
  }

  return (
    <div
      data-status={task.status}
      data-task-id={task.taskId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "8px 11px",
        borderRadius: "var(--radius-md, 10px)",
        border: "1px solid var(--glass-border)",
        background: "var(--surface-0)",
        borderLeft: `2px solid ${color}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Status dot — a single calm pulse while live, static once settled. */}
        <span
          className={live ? "pulse-dot" : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        {/* Status chip — mono, colour-keyed. */}
        <span
          style={{
            flexShrink: 0,
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color,
            padding: "2px 7px",
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Meta row: task-type badge + usage summary + settle reason. */}
      {(task.taskType || usageParts.length > 0 || task.settleReason) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
          }}
        >
          {task.taskType && (
            <span
              style={{
                textTransform: "uppercase",
                color: "var(--text-soft)",
              }}
            >
              {task.taskType.replace(/_/g, " ")}
            </span>
          )}
          {usageParts.length > 0 && <span>{usageParts.join(" · ")}</span>}
          {task.settleReason && (
            <span>{t("chat.workflow.reason", { reason: task.settleReason })}</span>
          )}
        </div>
      )}

      {/* Orphaned harvest line (S7) — "N/M agents finished · recoverable". The
          crash's already-completed work made visible + costed. Hover shows the
          last agent result summary (L10) + the run id as a resume/audit lead. */}
      {task.status === "orphaned" && task.harvest && (
        <div
          data-testid="workflow-harvest"
          title={
            [
              task.harvest.resultSummary,
              `run ${task.harvest.runId}`,
            ]
              .filter(Boolean)
              .join(" — ") || undefined
          }
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.03em",
            color: "var(--status-warn, #d0a54f)",
          }}
        >
          {t("chat.workflow.harvest", {
            done: task.harvest.completedAgents,
            total: task.harvest.startedAgents,
          })}
        </div>
      )}

      {/* Terminal summary line, when the task reported one. */}
      {isTerminalStatus(task.status) && task.summary && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {task.summary}
        </div>
      )}
    </div>
  );
}

export function WorkflowTaskCards({
  workId,
  sessionId,
  maxTerminal = 3,
}: {
  /** Owning work — filters the panel so a work switch never shows another
   *  work's tasks even when both reused the same session id (H5). */
  workId: string;
  sessionId: string;
  /** How many recently-settled cards to keep in the tail (older ones drop off). */
  maxTerminal?: number;
}) {
  const t = useT();
  const tasks = useWorkflowTaskStore((s) => s.tasks);
  const { active, terminal } = useMemo(
    () => panelTasksFor(tasks, workId, sessionId),
    [tasks, workId, sessionId],
  );
  const shown = useMemo(
    () => [...active, ...terminal.slice(0, maxTerminal)],
    [active, terminal, maxTerminal],
  );
  if (shown.length === 0) return null;

  return (
    <div
      data-testid="workflow-task-cards"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 12px",
        borderTop: "1px solid var(--divider)",
        maxHeight: 220,
        overflowY: "auto",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("chat.workflow.panelTitle")}
        {active.length > 0 ? ` · ${active.length}` : ""}
      </div>
      {shown.map((task) => (
        <WorkflowTaskCard key={taskKey(task)} task={task} t={t} />
      ))}
    </div>
  );
}
