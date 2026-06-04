import { useEffect, useRef, useState } from "react";
import { ReconnectingWS, type WSState } from "@/lib/ws";
import { useChatStore } from "./store";
import { useActiveSessionId, DEFAULT_SESSION_ID } from "./activeSession";
import type { StreamBlock, StreamBlockType, ViewerAction, ChatAttachment } from "./types";
import { extractViewerActions } from "./types";

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

  useEffect(() => {
    if (!workId) {
      setWsState("connecting");
      return;
    }
    // Clear stale bubbles on session switch so a freshly-created (empty)
    // session doesn't briefly show the previous session's history — the
    // backend only sends a `message_history` frame when the session HAS
    // history, so an empty session would otherwise inherit the old blocks.
    setBlocks([]);
    const ws = new ReconnectingWS<string>(`/ws/browser/${workId}/${sid}`);
    ref.current = ws;
    setWsState(ws.getState());
    const offState = ws.onState(setWsState);
    const off = ws.on((raw) => {
      try {
        const frame = JSON.parse(raw) as IncomingFrame;
        const data = (frame.data ?? {}) as DataDict;
        switch (frame.event) {
          case "message_history": {
            const blocks = (data.blocks as Array<DataDict>) ?? [];
            const seeded: StreamBlock[] = blocks.map((b, i) => ({
              id: `hist_${i}_${Date.now()}`,
              type: ((b.type as StreamBlockType) ?? "text") as StreamBlockType,
              text: asString(b.text),
              toolName: b.toolName as string | undefined,
              // Carry persisted user-message attachments through the WS reseed —
              // otherwise on reload the message_history frame overwrites the
              // HTTP-seeded blocks and the bubble thumbnails vanish.
              attachments: b.attachments as ChatAttachment[] | undefined,
              ts:
                typeof b.timestamp === "string"
                  ? Date.parse(b.timestamp)
                  : Date.now(),
            }));
            setBlocks(seeded);
            break;
          }
          case "block": {
            push({
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
            push({ type: "text", text: cleaned });
            break;
          }
          case "assistant_thinking": {
            push({ type: "thinking", text: asString(data.text) });
            break;
          }
          case "tool_use": {
            push({
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
          case "session_killed":
          case "session_closed":
          case "cli_exited": {
            setStreaming(false);
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
      off();
      offState();
      ws.dispose();
      ref.current = null;
    };
  }, [workId, sid, push, setBlocks, setStreaming, attachUsage]);

  return {
    state: wsState,
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
