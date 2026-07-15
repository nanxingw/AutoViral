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
 * block list. Identity is `workId :: sessionId :: generation :: taskId` (a
 * taskId alone is a per-process ephemeral id claude reuses across turns; the
 * generation disambiguates an old turn's task from a new turn's same-taskId
 * one; the workId keeps two DIFFERENT works that happen to share a session id —
 * e.g. both default to `s_1` — from cross-contaminating, H5). A same-id
 * `ui-workflow` REPLACES the prior view — it never stacks.
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

/** Journal-harvest result (S7) — mirror of the server `WorkflowHarvest`. Carried
 *  ONLY on an `orphaned` terminal: how many sub-agents actually finished (deduped
 *  by journal `key`) out of how many started, plus the run id / journal path as
 *  resume + audit leads, and (L10) a truncated summary of the last agent result. */
export interface WorkflowHarvest {
  runId: string;
  completedAgents: number;
  startedAgents: number;
  journalPath: string;
  /** L10 — truncated (~120 char) summary of the last harvested agent result. */
  resultSummary?: string;
}

export interface WorkflowTask {
  /** Owning work — part of the identity key so two works that share a session id
   *  (both default `s_1`) never cross-contaminate (H5). */
  workId: string;
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
  /** S7 — journal-harvest counts, ONLY on an `orphaned` terminal. */
  harvest?: WorkflowHarvest;
  ts?: number;
}

/** The stable client key: work + chat session + process generation + claude's
 *  ephemeral task id. workId leads so a session-only filter can never leak one
 *  work's tasks into another work that reused the same session id (H5). */
export function taskKey(t: {
  workId: string;
  sessionId: string;
  generation: number;
  taskId: string;
}): string {
  return `${t.workId}::${t.sessionId}::${t.generation}::${t.taskId}`;
}

/** Allowed terminal→terminal transitions — mirror of the server
 *  `TERMINAL_OVERRIDE_ALLOWED`. CLI-authoritative `killed→stopped` (a hard kill
 *  refined into a clean stop) + journal-harvest `stopped→orphaned` /
 *  `killed→orphaned` (S7: a settled task upgraded to orphaned with harvest
 *  counts). Everything else (e.g. `completed→killed`) is rejected. */
const TERMINAL_OVERRIDE_ALLOWED: ReadonlySet<string> = new Set([
  "killed->stopped",
  "stopped->orphaned",
  "killed->orphaned",
]);

/**
 * Should the next frame's DATA replace the stored task? Terminal is MONOTONIC:
 * a settled task is never revived by a late non-terminal frame (stale reorder /
 * a resumed generation flushing old bytes). Terminal→terminal moves are allowed
 * for the whitelist above, AND for an idempotent same-status re-broadcast — the
 * DATA still overwrites (H2: a `completed` re-broadcast carrying a fresh
 * summary/usage must not be dropped), but no NEW toast fires (that is gated
 * separately on the FRESH terminal crossing in {@link applyOne}). Mirrors the
 * server rule so both ends converge on the same final state regardless of order.
 */
function shouldReplace(prev: WorkflowTask | undefined, next: WorkflowTask): boolean {
  if (!prev) return true;
  if (!isTerminalStatus(prev.status)) return true; // non-terminal always advances
  if (!isTerminalStatus(next.status)) return false; // terminal → non-terminal: revive rejected
  if (prev.status === next.status) return true; // H2: same-terminal REPLACES data (toast gated in applyOne)
  return TERMINAL_OVERRIDE_ALLOWED.has(`${prev.status}->${next.status}`);
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
  // Same-id delivery advances the stored task. We MERGE prev←next (rather than a
  // raw replace) so a frame that omits a field it already reported — e.g. an
  // `orphaned` upgrade that carries `harvest` but re-affirms the settle — never
  // silently drops earlier metadata. frameToTask only sets DEFINED fields, so
  // next never clobbers with undefined; every field next DOES carry wins.
  const merged: WorkflowTask = prev ? { ...prev, ...next } : next;
  // Toast fires ONLY on the FRESH crossing into a terminal (prev was non-terminal
  // or absent). A same-terminal re-broadcast / a killed→stopped|orphaned upgrade
  // updates DATA but does not re-toast.
  const freshTerminal =
    isTerminalStatus(next.status) && (!prev || !isTerminalStatus(prev.status));
  return {
    tasks: { ...tasks, [key]: merged },
    toasted: freshTerminal ? merged : null,
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
  /** Replace the whole task set FOR ONE (work, session) from a
   *  `ui-workflow-snapshot` (reconnect restore). Other works/sessions are
   *  untouched; no toasts fire. */
  applySnapshot: (workId: string, sessionId: string, tasks: WorkflowTask[]) => void;
  /** Local fallback for `session_killed` / `cli_exited`: flip every still-live
   *  task of a (work, session) to `stopped` with a reason. The server terminal
   *  broadcast is primary — by the time this runs those tasks are usually
   *  already terminal (so this is a no-op); it only fires when the broadcast
   *  never arrived, so "killed with no notice" (issue 030) can't happen. */
  settleRunning: (workId: string, sessionId: string, reason: string) => void;
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
  applySnapshot: (workId, sessionId, incoming) =>
    set((s) => {
      const kept: Record<string, WorkflowTask> = {};
      for (const [k, v] of Object.entries(s.tasks)) {
        if (!(v.workId === workId && v.sessionId === sessionId)) kept[k] = v;
      }
      for (const raw of incoming) {
        const t: WorkflowTask = { ...raw, workId, sessionId };
        kept[taskKey(t)] = t;
      }
      return { tasks: kept };
    }),
  settleRunning: (workId, sessionId, reason) => {
    const toasts: WorkflowTask[] = [];
    set((s) => {
      let changed = false;
      const next = { ...s.tasks };
      for (const [k, v] of Object.entries(s.tasks)) {
        if (v.workId === workId && v.sessionId === sessionId && !isTerminalStatus(v.status)) {
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

/** Split a (work, session)'s tasks into the live list + the recent-terminal tail
 *  the panel renders. Pure — safe to call inside a `useMemo` over the task map.
 *  Filters by BOTH workId and sessionId so a work switch shows only its own
 *  tasks even when two works share a session id (H5). */
export function panelTasksFor(
  tasks: Record<string, WorkflowTask>,
  workId: string,
  sessionId: string,
): PanelTasks {
  const all = Object.values(tasks).filter(
    (t) => t.workId === workId && t.sessionId === sessionId,
  );
  const active = all.filter((t) => !isTerminalStatus(t.status));
  const terminal = all.filter((t) => isTerminalStatus(t.status));
  active.sort((a, b) => (a.startTime ?? a.ts ?? 0) - (b.startTime ?? b.ts ?? 0));
  terminal.sort((a, b) => (b.endTime ?? b.ts ?? 0) - (a.endTime ?? a.ts ?? 0));
  return { active, terminal };
}
