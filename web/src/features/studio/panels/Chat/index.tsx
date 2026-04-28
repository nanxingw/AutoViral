import { useChatSocket } from "@/features/chat/useChatSocket";
import { useChatStore } from "@/features/chat/store";
import type { LocatorData } from "@/features/chat/types";
import { LocatorBlockView } from "@/features/chat/LocatorBlock";
import { useComposition } from "@/features/studio/store";
import { useState } from "react";
import { QuickActions } from "./QuickActions";

// Phase 2.3 — split a text body into alternating markdown / locator segments.
// Uses a g-flagged regex to find every <viewer-locator/> tag; the regex shape
// mirrors LOCATOR_RX in chat/types.ts (4-capture-group: label-double, label-single,
// data-double, data-single). On bad JSON in data, the segment falls through as
// raw text so nothing is silently lost.
const LOCATOR_RX_GLOBAL =
  /<viewer-locator\s+label\s*=\s*(?:"([^"]+)"|'([^']+)')\s+data\s*=\s*(?:"([^"]+)"|'([^']+)')\s*\/?>/gi;

interface MarkdownSegment {
  kind: "markdown";
  text: string;
}
interface LocatorSegment {
  kind: "locator";
  label: string;
  data: LocatorData;
}

function segmentTextWithLocators(
  text: string,
): Array<MarkdownSegment | LocatorSegment> {
  const out: Array<MarkdownSegment | LocatorSegment> = [];
  let lastIdx = 0;
  for (const m of text.matchAll(LOCATOR_RX_GLOBAL)) {
    if (m.index === undefined) continue;
    if (m.index > lastIdx) {
      out.push({ kind: "markdown", text: text.slice(lastIdx, m.index) });
    }
    const label = m[1] ?? m[2] ?? "";
    const dataRaw = m[3] ?? m[4] ?? "{}";
    try {
      const data = JSON.parse(dataRaw) as LocatorData;
      out.push({ kind: "locator", label, data });
    } catch {
      // bad JSON — render the raw tag as plain text so nothing is silently dropped
      out.push({ kind: "markdown", text: m[0] });
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    out.push({ kind: "markdown", text: text.slice(lastIdx) });
  }
  return out;
}

function jumpTo(data: LocatorData) {
  const s = useComposition.getState();
  if (data.clipId) {
    s.setSelection(data.clipId);
  }
  if (typeof data.time === "number" && s.comp) {
    s.setFrame(Math.round(data.time * s.comp.fps));
  }
}

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
            {segmentTextWithLocators(b.text).map((seg, i) =>
              seg.kind === "markdown" ? (
                <span key={i}>{seg.text}</span>
              ) : (
                <LocatorBlockView
                  key={i}
                  label={seg.label}
                  data={seg.data}
                  onJump={jumpTo}
                />
              ),
            )}
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
