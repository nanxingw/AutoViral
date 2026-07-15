import { create } from "zustand";
import { useToastStore, type ToastVariant } from "@/stores/toast";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

/**
 * PRD-0015 S4 — durable client state for harness-tracked background tasks a
 * chat agent starts (a Workflow run, a background Bash, a subagent). This is
 * the web mirror of the server `BackgroundTaskRegistry` (S2) fed over the
 * `ui-workflow` / `ui-workflow-snapshot` frames (event-stream.md).
 *
 * Task state is MUTABLE CONCURRENT state, not an append-only transcript — so
 * this is a keyed registry (like the render-progress channel), NOT the chat
 * block list. Identity is `sessionId :: generation :: taskId` (a taskId alone
 * is a per-process ephemeral id claude reuses across turns; the generation
 * disambiguates an old turn's task from a new turn's same-taskId one). A
 * same-id `ui-workflow` REPLACES the prior view — it never stacks.
 */

export type WorkflowTaskStatus =
  | "running"
  | "pending-settle"
  | "completed"
  | "failed"
  | "killed"
  | "stopped"
  | "orphaned";

const TERMINAL: ReadonlySet<WorkflowTaskStatus> = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
  "orphaned",
]);

export function isTerminalStatus(s: WorkflowTaskStatus): boolean {
  return TERMINAL.has(s);
}

/** Cost / effort counters as the server passes them through (not enumerated;
 *  `total_tokens` / `tool_uses` / `agents` / `duration_ms` are the ones the
 *  card surfaces today). */
export interface WorkflowTaskUsage {
  total_tokens?: number;
  tool_uses?: number;
  agents?: number;
  duration_ms?: number;
  [k: string]: number | undefined;
}

export interface WorkflowTask {
  sessionId: string;
  taskId: string;
  generation: number;
  status: WorkflowTaskStatus;
  taskType?: string;
  description?: string;
  toolUseId?: string;
  summary?: string;
  usage?: WorkflowTaskUsage;
  outputFile?: string;
  startTime?: number;
  endTime?: number;
  /** Present only on a SYNTHESIZED terminal (host process exited while the task
   *  was live) — e.g. `cli_exit` / `daemon_shutdown`. A natural CLI terminal
   *  has none. */
  settleReason?: string;
  ts?: number;
}

/** The stable client key: process generation + claude's ephemeral task id,
 *  scoped to the owning chat session. */
export function taskKey(t: {
  sessionId: string;
  generation: number;
  taskId: string;
}): string {
  return `${t.sessionId}::${t.generation}::${t.taskId}`;
}

/**
 * Terminal is MONOTONIC. A settled task is never revived by a late non-terminal
 * frame (stale reorder / a resumed generation flushing old bytes). The one
 * terminal→terminal move allowed is the CLI-authoritative `killed → stopped`
 * (the server refines a hard kill into a clean stop). Everything else that
 * targets an already-terminal task is rejected. Mirrors the server rule so both
 * ends converge on the same final state regardless of frame ordering.
 */
function shouldReplace(prev: WorkflowTask | undefined, next: WorkflowTask): boolean {
  if (!prev) return true;
  if (!isTerminalStatus(prev.status)) return true; // non-terminal always advances
  if (!isTerminalStatus(next.status)) return false; // terminal → non-terminal: revive rejected
  if (prev.status === next.status) return false; // idempotent terminal re-broadcast: no-op (no re-toast)
  return prev.status === "killed" && next.status === "stopped";
}

interface ApplyResult {
  tasks: Record<string, WorkflowTask>;
  /** The task that JUST crossed into a terminal state (fires one toast), or null. */
  toasted: WorkflowTask | null;
}

function applyOne(
  tasks: Record<string, WorkflowTask>,
  next: WorkflowTask,
): ApplyResult {
  const key = taskKey(next);
  const prev = tasks[key];
  if (!shouldReplace(prev, next)) return { tasks, toasted: null };
  // Same-id delivery REPLACES the prior view (event-stream.md) — not a merge.
  const freshTerminal =
    isTerminalStatus(next.status) && (!prev || !isTerminalStatus(prev.status));
  return {
    tasks: { ...tasks, [key]: next },
    toasted: freshTerminal ? next : null,
  };
}

/** One toast per FRESH terminal transition. Localized off the runtime locale
 *  (the store is called from non-React frame handlers, so it reads MESSAGES
 *  directly like the studio store's warnEffectFailed). */
function fireTerminalToast(task: WorkflowTask): void {
  const locale = useLocaleStore.getState().locale;
  const wf = MESSAGES[locale].chat.workflow;
  const template = (wf.toast as Record<string, string | undefined>)[task.status];
  if (!template) return;
  const name = task.description || wf.untitled;
  const variant: ToastVariant =
    task.status === "completed" ? "success" : task.status === "failed" ? "error" : "warn";
  useToastStore.getState().push({
    variant,
    message: template.replace("{name}", name),
    ttlMs: 5000,
  });
}

interface WorkflowTaskStore {
  /** All tasks across every session, keyed by `taskKey`. */
  tasks: Record<string, WorkflowTask>;
  /** Apply one incremental `ui-workflow` frame (upsert + state machine). */
  upsert: (task: WorkflowTask) => void;
  /** Replace the whole task set FOR ONE SESSION from a `ui-workflow-snapshot`
   *  (reconnect restore). Other sessions are untouched; no toasts fire. */
  applySnapshot: (sessionId: string, tasks: WorkflowTask[]) => void;
  /** Local fallback for `session_killed` / `cli_exited`: flip every still-live
   *  task of a session to `stopped` with a reason. The server terminal
   *  broadcast is primary — by the time this runs those tasks are usually
   *  already terminal (so this is a no-op); it only fires when the broadcast
   *  never arrived, so "killed with no notice" (issue 030) can't happen. */
  settleRunning: (sessionId: string, reason: string) => void;
  clear: () => void;
}

export const useWorkflowTaskStore = create<WorkflowTaskStore>((set) => ({
  tasks: {},
  upsert: (task) => {
    let toasted: WorkflowTask | null = null;
    set((s) => {
      const r = applyOne(s.tasks, task);
      toasted = r.toasted;
      return r.tasks === s.tasks ? s : { tasks: r.tasks };
    });
    if (toasted) fireTerminalToast(toasted);
  },
  applySnapshot: (sessionId, incoming) =>
    set((s) => {
      const kept: Record<string, WorkflowTask> = {};
      for (const [k, v] of Object.entries(s.tasks)) {
        if (v.sessionId !== sessionId) kept[k] = v;
      }
      for (const raw of incoming) {
        const t: WorkflowTask = { ...raw, sessionId };
        kept[taskKey(t)] = t;
      }
      return { tasks: kept };
    }),
  settleRunning: (sessionId, reason) => {
    const toasts: WorkflowTask[] = [];
    set((s) => {
      let changed = false;
      const next = { ...s.tasks };
      for (const [k, v] of Object.entries(s.tasks)) {
        if (v.sessionId === sessionId && !isTerminalStatus(v.status)) {
          const stopped: WorkflowTask = {
            ...v,
            status: "stopped",
            settleReason: v.settleReason ?? reason,
            endTime: v.endTime ?? Date.now(),
          };
          next[k] = stopped;
          toasts.push(stopped);
          changed = true;
        }
      }
      return changed ? { tasks: next } : s;
    });
    for (const t of toasts) fireTerminalToast(t);
  },
  clear: () => set({ tasks: {} }),
}));

export interface PanelTasks {
  /** Non-terminal tasks (running / pending-settle), oldest-started first. */
  active: WorkflowTask[];
  /** Settled tasks, most-recently-ended first (the "recent terminals" tail). */
  terminal: WorkflowTask[];
}

/** Split a session's tasks into the live list + the recent-terminal tail the
 *  panel renders. Pure — safe to call inside a `useMemo` over the task map. */
export function panelTasksFor(
  tasks: Record<string, WorkflowTask>,
  sessionId: string,
): PanelTasks {
  const all = Object.values(tasks).filter((t) => t.sessionId === sessionId);
  const active = all.filter((t) => !isTerminalStatus(t.status));
  const terminal = all.filter((t) => isTerminalStatus(t.status));
  active.sort((a, b) => (a.startTime ?? a.ts ?? 0) - (b.startTime ?? b.ts ?? 0));
  terminal.sort((a, b) => (b.endTime ?? b.ts ?? 0) - (a.endTime ?? a.ts ?? 0));
  return { active, terminal };
}
