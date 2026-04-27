import { useChatSocket } from "@/features/chat/useChatSocket";
import { useChatStore } from "@/features/chat/store";
import { useState } from "react";
import { QuickActions } from "./QuickActions";

export function ChatPanel({ workId }: { workId: string }) {
  const { send } = useChatSocket(workId);
  const blocks = useChatStore((s) => s.blocks);
  const [input, setInput] = useState("");
  const submit = () => {
    if (input.trim()) {
      send(input);
      setInput("");
    }
  };
  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {blocks.map((b) => (
          <div key={b.id} className={`chat-block chat-${b.type}`}>
            {b.text}
          </div>
        ))}
      </div>
      <QuickActions />
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="问点什么…"
          style={{ flex: 1 }}
        />
        <button onClick={submit}>↵</button>
      </div>
    </div>
  );
}
