import { useEffect, useRef } from "react";
import { ReconnectingWS } from "@/lib/ws";
import { useChatStore } from "./store";
import type { StreamBlock, StreamBlockType } from "./types";

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

export function useChatSocket(workId: string | null) {
  const ref = useRef<ReconnectingWS | null>(null);
  const push = useChatStore((s) => s.push);
  const setBlocks = useChatStore((s) => s.setBlocks);
  const setStreaming = useChatStore((s) => s.setStreaming);

  useEffect(() => {
    if (!workId) return;
    const ws = new ReconnectingWS<string>(`/ws/browser/${workId}`);
    ref.current = ws;
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
            });
            break;
          }
          case "assistant_text": {
            push({ type: "text", text: asString(data.text) });
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
          case "turn_complete":
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
      ws.dispose();
      ref.current = null;
    };
  }, [workId, push, setBlocks, setStreaming]);

  return {
    send(text: string) {
      // Bridge expects `{ action: "send", text }` — see ws-bridge.ts ws.on
      // 'message' handler. Sending `{ type: "user", text }` was a no-op.
      ref.current?.send(JSON.stringify({ action: "send", text }));
      // Optimistic local echo so the bubble appears instantly. The bridge
      // will also broadcast a `block` event with type=user shortly after,
      // which the receive side will append again — accept the duplicate
      // for now; deduping needs an id-based merge that doesn't exist yet.
      push({ type: "user", text });
    },
  };
}
