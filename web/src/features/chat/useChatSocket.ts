import { useEffect, useRef, useState } from "react";
import { ReconnectingWS, type WSState } from "@/lib/ws";
import { useChatStore } from "./store";
import { useActiveSessionId, DEFAULT_SESSION_ID } from "./activeSession";
import type { StreamBlockType, ViewerAction, ChatAttachment } from "./types";
import { extractViewerActions } from "./types";
import { seedBlocksFromHistory } from "./seed";
import { apiFetch } from "@/lib/api";
import type { ChatCommandCatalog, ChatCommandStatus } from "./types";
import {
  useWorkflowTaskStore,
  type WorkflowTask,
  type WorkflowTaskStatus,
} from "./workflow-tasks.store";
import { useToastStore } from "@/stores/toast";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

/** Minimal XML attribute escape for the <attachments> envelope. Filenames are
 *  server-sanitised (no slashes) but may still contain quotes / angle brackets. */
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the `<attachments>` envelope the agent reads. Paths are workspace-
 *  relative; the agent joins them onto its workspace root (its cwd is the
 *  project root, not the work dir — see ws-bridge buildSystemPrompt). */
export function buildAttachmentsEnvelope(attachments: ChatAttachment[]): string | null {
  if (!attachments.length) return null;
  const lines = attachments.map(
    (a) => `  <file path="${escapeXmlAttr(a.path)}" type="${a.kind}" name="${escapeXmlAttr(a.name)}" />`,
  );
  return `<attachments>\n${lines.join("\n")}\n</attachments>`;
}

// The bridge speaks `{ event, data, timestamp }` frames in both directions —
// see src/ws-bridge.ts. Frontend used to assume a flat `{ type, text }`
// shape, which silently mis-parsed every frame. This adapter is the
// translation layer between bridge events and the local ChatStore.
interface IncomingFrame {
  event: string;
  data?: unknown;
  timestamp?: string;
}

type DataDict = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Translate a `ui-workflow` (or a `ui-workflow-snapshot` per-task entry) data
 *  dict into a client `WorkflowTask`. `fallbackWorkId` / `fallbackSessionId`
 *  supply identity for snapshot entries, whose workId/sessionId live on the
 *  wrapper, not per-task. Only defined fields are set so a REPLACE/MERGE never
 *  clobbers a value with undefined. Returns null when the identity fields are
 *  missing. The `harvest` object (S7) is carried through so an `orphaned` card
 *  can show "N/M agents recovered". */
function frameToTask(
  d: DataDict,
  fallbackWorkId: string,
  fallbackSessionId: string,
): WorkflowTask | null {
  const taskId = asString(d.taskId);
  if (!taskId) return null;
  const workId = asString(d.workId) || fallbackWorkId;
  const sessionId = asString(d.sessionId) || fallbackSessionId;
  const generation = asNumber(d.generation) ?? 0;
  const status = (asString(d.status) || "running") as WorkflowTaskStatus;
  const task: WorkflowTask = { workId, sessionId, taskId, generation, status };
  if (typeof d.taskType === "string") task.taskType = d.taskType;
  if (typeof d.description === "string") task.description = d.description;
  if (typeof d.toolUseId === "string") task.toolUseId = d.toolUseId;
  if (typeof d.summary === "string") task.summary = d.summary;
  if (typeof d.outputFile === "string") task.outputFile = d.outputFile;
  if (typeof d.settleReason === "string") task.settleReason = d.settleReason;
  const startTime = asNumber(d.startTime);
  if (startTime !== undefined) task.startTime = startTime;
  const endTime = asNumber(d.endTime);
  if (endTime !== undefined) task.endTime = endTime;
  const ts = asNumber(d.ts);
  if (ts !== undefined) task.ts = ts;
  if (d.usage && typeof d.usage === "object") {
    task.usage = d.usage as WorkflowTask["usage"];
  }
  // S7 — harvest counts ride along on an `orphaned` frame.
  if (d.harvest && typeof d.harvest === "object") {
    task.harvest = d.harvest as WorkflowTask["harvest"];
  }
  return task;
}

/**
 * Optional callback that returns a `<viewer-context>...</viewer-context>`
 * block summarising the user's current selection / playhead / page state.
 * If provided, the block is prepended to every outgoing message before it
 * hits the agent. The local chat bubble still shows only the user's typed
 * text — the context envelope is for the agent's eyes, not the user's.
 *
 * Inspired by pneuma's ModeManifest.extractContext (clipcraft mode).
 */
export type GetViewerContext = () => string | null;

/** Handler called for every `<viewer-action/>` tag the agent emits. The hook
 *  strips the tag from the visible text and invokes this with the parsed
 *  payload. Editors that don't care about a particular action type just
 *  ignore it. Mirrors pneuma's actionRequest dispatcher (clipcraft's Plan
 *  5+). */
export type DispatchViewerAction = (action: ViewerAction) => void;

export function useChatSocket(
  workId: string | null,
  getViewerContext?: GetViewerContext,
  dispatchAction?: DispatchViewerAction,
  /**
   * R43 — fired once per `turn_complete` after streaming is marked idle.
   * Studio uses this to refetch composition.yaml when the agent has
   * (potentially) written to disk via the Write tool, which bypasses the
   * client's autosave channel. Without this, users had to hard-refresh
   * to see new clips/aspect/duration the agent just produced.
   */
  onTurnComplete?: () => void,
  /**
   * ADR-008 §5 / I24 — which chat session to connect to. When omitted we
   * read the work's active session from the activeSession store (set by the
   * RightPane session strip). The session id is carried in the WS path
   * (`/ws/browser/{workId}/{sessionId}`); the backend re-seeds that session's
   * history over the `message_history` frame, so switching sessions = new
   * socket + reseed, no prop threading through ChatPanel.
   */
  sessionId?: string,
) {
  const ref = useRef<ReconnectingWS | null>(null);
  const push = useChatStore((s) => s.push);
  const setBlocks = useChatStore((s) => s.setBlocks);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const attachUsage = useChatStore((s) => s.attachLastTurnUsage);
  const upsertCommand = useChatStore((s) => s.upsertCommand);
  // Reactive active session for this work — switching it re-runs the effect.
  const activeSessionId = useActiveSessionId(workId);
  const sid = sessionId ?? activeSessionId ?? DEFAULT_SESSION_ID;
  // Keep latest callback in a ref so the WS effect doesn't re-subscribe
  // every time the parent re-renders with a new arrow-function reference.
  const onTurnCompleteRef = useRef(onTurnComplete);
  useEffect(() => {
    onTurnCompleteRef.current = onTurnComplete;
  }, [onTurnComplete]);
  // Connection state surfaced to the chat UI so users see when the bridge
  // is reconnecting instead of silently losing messages into the void.
  const [wsState, setWsState] = useState<WSState>("connecting");
  const [commandCatalog, setCommandCatalog] = useState<ChatCommandCatalog | null>(null);
  // Local commands return only a command_result frame. Remember the arguments
  // for display without creating an optimistic history echo.
  const pendingCommandArgs = useRef(new Map<string, string>());

  useEffect(() => {
    if (!workId) {
      setWsState("connecting");
      setCommandCatalog(null);
      return;
    }
    // Clear stale bubbles on session switch so a freshly-created (empty)
    // session doesn't briefly show the previous session's history — the
    // backend only sends a `message_history` frame when the session HAS
    // history, so an empty session would otherwise inherit the old blocks.
    setBlocks([]);
    setCommandCatalog(null);
    pendingCommandArgs.current.clear();
    let capabilityFrameCount = 0;
    let cancelled = false;
    // The HTTP catalog makes the menu available before a provider emits a new
    // init frame. Any WS capability frame wins, preventing a slower fetch from
    // overwriting live session capabilities.
    void apiFetch<ChatCommandCatalog>(
      `/api/works/${workId}/chat-commands?sessionId=${encodeURIComponent(sid)}`,
    )
      .then((catalog) => {
        if (!cancelled && capabilityFrameCount === 0) setCommandCatalog(catalog);
      })
      .catch(() => {});
    const ws = new ReconnectingWS<string>(`/ws/browser/${workId}/${sid}`);
    ref.current = ws;
    setWsState(ws.getState());
    const offState = ws.onState(setWsState);
    const off = ws.on((raw) => {
      try {
        const frame = JSON.parse(raw) as IncomingFrame;
        const data = (frame.data ?? {}) as DataDict;
        switch (frame.event) {
          case "chat_capabilities": {
            capabilityFrameCount += 1;
            if (Array.isArray(data.commands)) {
              setCommandCatalog(data as unknown as ChatCommandCatalog);
            }
            break;
          }
          case "command_started": {
            const name = asString(data.command).replace(/^\/+/, "");
            const args = asString(data.args).trim();
            pendingCommandArgs.current.set(name, args);
            upsertCommand({ name, args, status: "running" });
            break;
          }
          case "command_result":
          case "command_error": {
            const name = asString(data.command).replace(/^\/+/, "");
            const nested = (data.data ?? {}) as DataDict;
            const status = (
              frame.event === "command_error"
                ? data.status === "unsupported"
                  ? "unsupported"
                  : "error"
                : "ok"
            ) as ChatCommandStatus;
            const result = asString(nested.result ?? data.message);
            upsertCommand({
              name,
              args: pendingCommandArgs.current.get(name) ?? "",
              status,
              result: result || undefined,
            });
            pendingCommandArgs.current.delete(name);
            break;
          }
          case "message_history": {
            const blocks = (data.blocks as Array<DataDict>) ?? [];
            setBlocks(seedBlocksFromHistory(blocks));
            break;
          }
          case "block": {
            push({
              // A1 — carry the server's stable id so this live user echo dedups
              // against the same block on reload / reconnect.
              id: data.id as string | undefined,
              type: ((data.type as StreamBlockType) ?? "text") as StreamBlockType,
              text: asString(data.text),
              // Live broadcast of a user message (e.g. a second tab) carries its
              // attachments too, so cross-tab bubbles render thumbnails.
              attachments: data.attachments as ChatAttachment[] | undefined,
            });
            break;
          }
          case "assistant_text": {
            // Strip <viewer-action/> tags + dispatch them before the text
            // hits the chat bubble. Otherwise users see raw tags inline,
            // and the action gets lost.
            const raw = asString(data.text);
            const { cleaned, actions } = extractViewerActions(raw);
            for (const a of actions) {
              try { dispatchAction?.(a); } catch { /* swallow handler errors */ }
            }
            // A1 — carry the server block id so a live stream block dedups
            // against its reload/reconnect twin (by-id, even non-contiguous).
            push({ type: "text", text: cleaned, id: data.id as string | undefined });
            break;
          }
          case "assistant_thinking": {
            push({ type: "thinking", text: asString(data.text), id: data.id as string | undefined });
            break;
          }
          case "tool_use": {
            push({
              id: data.id as string | undefined,
              type: "tool_use",
              text: asString(data.input ?? data.text ?? data),
              toolName:
                (data.name as string) ??
                (data.tool as string) ??
                (data.toolName as string) ??
                "tool",
            });
            break;
          }
          case "tool_result": {
            push({
              id: data.id as string | undefined,
              type: "tool_result",
              text: asString(data.text ?? data.output ?? data.content),
            });
            break;
          }
          case "session_state": {
            setStreaming(!(data.idle ?? true));
            break;
          }
          case "session_ready":
          case "analyzing": {
            setStreaming(true);
            break;
          }
          case "turn_complete": {
            setStreaming(false);
            // Fold cost/duration/tokens into the last text bubble so the
            // user sees what this round actually consumed.
            const cost =
              typeof data.cost === "number" ? data.cost : undefined;
            const durationMs =
              typeof data.durationMs === "number" ? data.durationMs : undefined;
            const usage = (data.usage ?? {}) as Record<string, number>;
            if (
              cost !== undefined ||
              durationMs !== undefined ||
              Object.keys(usage).length > 0
            ) {
              attachUsage({
                costUsd: cost,
                durationMs,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheCreationTokens: usage.cache_creation_input_tokens,
                cacheReadTokens: usage.cache_read_input_tokens,
              });
            }
            // R43 — pull-on-turn refetch hook. Agent may have written
            // composition.yaml via Write tool (out-of-band of client
            // autosave); fire callback so the page can re-sync.
            try {
              onTurnCompleteRef.current?.();
            } catch {
              /* swallow handler errors so chat stream doesn't break */
            }
            break;
          }
          // PRD-0015 S4 — background-task lifecycle (event-stream.md). Task
          // state is mutable concurrent state (a keyed registry), not chat
          // blocks, so it flows into a SEPARATE store, not push(). The store
          // enforces same-id replace + terminal monotonicity + one-shot toast.
          case "ui-workflow": {
            const task = frameToTask(data, workId ?? "", sid);
            if (task) useWorkflowTaskStore.getState().upsert(task);
            break;
          }
          case "ui-workflow-snapshot": {
            // Full (work, session) replace on (re)connect. Snapshot arrives FIRST
            // (the server orders it before any incremental), so a refresh restores
            // task state without depending on being online when each frame fired.
            const snapWork = asString(data.workId) || workId || "";
            const snapSession = asString(data.sessionId) || sid;
            const rawTasks = Array.isArray(data.tasks) ? (data.tasks as DataDict[]) : [];
            const tasks = rawTasks
              .map((d) => frameToTask(d, snapWork, snapSession))
              .filter((t): t is WorkflowTask => t != null);
            useWorkflowTaskStore.getState().applySnapshot(snapWork, snapSession, tasks);
            break;
          }
          case "chat_notice": {
            // Transient, NOT persisted to chat history (event-stream.md) — so a
            // toast is the honest surface (a durable chat bubble would look
            // persisted and get wiped on the next history reseed anyway). Prefer
            // the server-supplied (already-localized) text; fall back to a
            // locale string keyed by notice kind.
            const kind = asString(data.kind);
            const locale = useLocaleStore.getState().locale;
            const fallback = (
              MESSAGES[locale].chat.workflow.notice as Record<string, string | undefined>
            )[kind];
            const message = asString(data.message) || fallback;
            if (message) {
              useToastStore.getState().push({ variant: "info", message, ttlMs: 5000 });
            }
            break;
          }
          case "session_killed":
          case "session_closed":
          case "cli_exited": {
            setStreaming(false);
            // Local fallback: if the server's terminal ui-workflow broadcast
            // never arrived, flip this session's still-live tasks to stopped so
            // "killed with no notice" (issue 030) can't happen. When the server
            // DID broadcast, those tasks are already terminal → this is a no-op
            // (terminal monotonicity), so no double toast.
            const settleWork = asString(data.workId) || workId || "";
            const settleSession = asString(data.sessionId) || sid;
            const reason = asString(data.reason) || frame.event;
            useWorkflowTaskStore.getState().settleRunning(settleWork, settleSession, reason);
            break;
          }
          // Silently ignore research_*, search_*, cli_event, cli_stderr —
          // not surfaced in the chat UI today.
        }
      } catch {
        // ignore non-JSON frames
      }
    });
    return () => {
      cancelled = true;
      off();
      offState();
      ws.dispose();
      ref.current = null;
    };
  }, [workId, sid, push, setBlocks, setStreaming, attachUsage, upsertCommand]);

  return {
    state: wsState,
    commandCatalog,
    sendCommand(name: string, args = "") {
      const normalizedName = name.replace(/^\/+/, "").trim().toLowerCase();
      const normalizedArgs = args.trim();
      pendingCommandArgs.current.set(normalizedName, normalizedArgs);
      // Intentionally bypass getViewerContext, attachment envelopes, and the
      // ordinary message's optimistic `user` block.
      ref.current?.send(JSON.stringify({
        action: "command",
        name: normalizedName,
        args: normalizedArgs,
      }));
    },
    send(text: string, attachments?: ChatAttachment[]) {
      // The wire message prepends two agent-only envelopes, in order:
      //   1. <viewer-context> — what the user has selected / playhead state
      //   2. <attachments>    — media the user attached (workspace-rel paths)
      // Both are for the agent's eyes; the local bubble shows only the user's
      // text (+ attachment thumbnails). Mirrors clipcraft's extractContext.
      const ctx = getViewerContext?.() ?? null;
      const attachEnv = attachments?.length ? buildAttachmentsEnvelope(attachments) : null;
      const wireText = [ctx, attachEnv, text].filter(Boolean).join("\n\n");
      // Bridge expects `{ action: "send", text }` — see ws-bridge.ts ws.on
      // 'message' handler. Sending `{ type: "user", text }` was a no-op.
      ref.current?.send(JSON.stringify({ action: "send", text: wireText }));
      // Optimistic local echo: the user's raw text + attachment thumbnails,
      // never the verbose context/attachment envelopes.
      push({ type: "user", text, attachments });
    },
  };
}
