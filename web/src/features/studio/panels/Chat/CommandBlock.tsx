import type { StreamBlock } from "@/features/chat/types";
import { useT } from "@/i18n/useT";

export function CommandBlock({ block }: { block: StreamBlock }) {
  const t = useT();
  const status = block.commandStatus ?? "error";
  const statusKey = {
    running: "chatCommands.status.running",
    ok: "chatCommands.status.completed",
    unsupported: "chatCommands.status.unsupported",
    error: "chatCommands.status.failed",
  } as const;

  return (
    <div
      data-testid="chat-command-block"
      data-command-status={status}
      style={{
        alignSelf: "stretch",
        padding: "8px 10px",
        border: "1px solid var(--glass-border)",
        borderLeft: `3px solid ${status === "error" || status === "unsupported" ? "var(--status-warn, #d0a54f)" : "var(--accent)"}`,
        borderRadius: 8,
        background: "var(--surface-0)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <code style={{ color: "var(--accent)" }}>{block.text}</code>
        <span style={{ color: "var(--text-dimmer)" }}>{t(statusKey[status])}</span>
      </div>
      {block.commandResult ? (
        <div style={{ marginTop: 6, color: "var(--text-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {block.commandResult}
        </div>
      ) : null}
    </div>
  );
}
