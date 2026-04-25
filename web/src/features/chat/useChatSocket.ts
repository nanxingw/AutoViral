import { useEffect, useRef } from "react";
import { ReconnectingWS } from "@/lib/ws";
import { useChatStore } from "./store";
import type { StreamBlockType } from "./types";

interface IncomingMessage {
  type: StreamBlockType | "stream_start" | "stream_end";
  text?: string;
  toolName?: string;
  questions?: string[];
}

export function useChatSocket(workId: string | null) {
  const ref = useRef<ReconnectingWS | null>(null);
  const push = useChatStore((s) => s.push);
  const setStreaming = useChatStore((s) => s.setStreaming);

  useEffect(() => {
    if (!workId) return;
    const ws = new ReconnectingWS<string>(`/ws/works/${workId}`);
    ref.current = ws;
    const off = ws.on((raw) => {
      try {
        const msg = JSON.parse(raw) as IncomingMessage;
        if (msg.type === "stream_start") setStreaming(true);
        else if (msg.type === "stream_end") setStreaming(false);
        else push({ type: msg.type, text: msg.text ?? "", toolName: msg.toolName, questions: msg.questions });
      } catch {
        // ignore non-JSON frames
      }
    });
    return () => {
      off();
      ws.dispose();
    };
  }, [workId, push, setStreaming]);

  return {
    send(text: string) {
      ref.current?.send(JSON.stringify({ type: "user", text }));
      push({ type: "user", text });
    },
  };
}
