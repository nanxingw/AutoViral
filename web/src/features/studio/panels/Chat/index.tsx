import { useChatSocket } from "@/features/chat/useChatSocket";
import { useChatStore } from "@/features/chat/store";
import type { StreamBlock, LocatorData, TurnUsage } from "@/features/chat/types";
import { LocatorBlockView } from "@/features/chat/LocatorBlock";
import { useComposition } from "@/features/studio/store";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { QuickActions } from "./QuickActions";

const SKIP_TYPES = new Set(["step_divider"]); // D3 removed; ignore legacy markers

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

/** Default jump handler — moves the studio playhead/selection to the locator
 *  target. Editors that don't have a clip-based composition should pass an
 *  alternative `onJumpToLocator` (e.g. the carousel editor's slide-jump). */
function jumpToStudioComposition(data: LocatorData) {
  const s = useComposition.getState();
  if (data.clipId) {
    s.setSelection(data.clipId);
  }
  if (typeof data.time === "number" && s.comp) {
    s.setFrame(Math.round(data.time * s.comp.fps));
  }
}

export interface ChatPanelProps {
  workId: string;
  /** Editor-specific shortcut buttons rendered between messages and composer.
   *  Defaults to Studio's <QuickActions /> for backward compatibility. */
  quickActions?: ReactNode;
  /** Called when the user activates an inline `<viewer-locator/>` block in an
   *  assistant message. Defaults to studio playhead/selection jump. */
  onJumpToLocator?: (data: LocatorData) => void;
  /** Returns a `<viewer-context>...</viewer-context>` string describing the
   *  current viewer selection / state. If provided, this is prepended to
   *  every outgoing message so the agent knows what the user is looking at.
   *  Pneuma clipcraft's extractContext, ported in (2026-05-08). */
  getViewerContext?: () => string | null;
  /** Called for every `<viewer-action/>` tag the agent emits — the chat
   *  layer strips the tag from the visible text before this fires. The
   *  page should react by selecting / seeking / focusing as the action
   *  describes. Mirrors pneuma's actionRequest. */
  dispatchAction?: (action: import("@/features/chat/types").ViewerAction) => void;
}

// CLI aliases → current 4.x family member. The backend stores a short alias
// like "opus" / "sonnet" / "haiku" in config.model and passes it verbatim to
// the Claude Code CLI (`--model opus`). The CLI resolves it to whatever the
// latest version of that family is. Mirror that resolution in the UI badge so
// it stops lying about the actual model behind the chat.
const MODEL_ALIAS_LABEL: Record<string, string> = {
  opus: "CLAUDE-OPUS-4.7",
  sonnet: "CLAUDE-SONNET-4.6",
  haiku: "CLAUDE-HAIKU-4.5",
};

export function ChatPanel({
  workId,
  quickActions,
  onJumpToLocator = jumpToStudioComposition,
  getViewerContext,
  dispatchAction,
}: ChatPanelProps) {
  const { send } = useChatSocket(workId, getViewerContext, dispatchAction);
  const blocks = useChatStore((s) => s.blocks);
  const setBlocks = useChatStore((s) => s.setBlocks);
  const streaming = useChatStore((s) => s.streaming);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [modelLabel, setModelLabel] = useState("CLAUDE-OPUS-4.7");
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Pull the live model from the server once on mount. Falls back silently
  // to the default opus label if the call fails.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ model?: string }>(`/api/status`)
      .then((data) => {
        if (cancelled) return;
        const raw = (data.model ?? "opus").toLowerCase();
        setModelLabel(MODEL_ALIAS_LABEL[raw] ?? raw.toUpperCase());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load chat history on mount / workId change. Without this, switching into a
  // work showed an empty panel even when chat.json had hundreds of past blocks.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    setBlocks([]);
    (async () => {
      try {
        const data = await apiFetch<{ blocks: StreamBlock[] }>(`/api/works/${workId}/chat`);
        if (cancelled) return;
        const seeded = (data.blocks ?? [])
          .filter((b) => !SKIP_TYPES.has(b.type as string))
          .map((b, i) => ({
            ...b,
            // Backend blocks may not carry id/ts in the legacy shape — synthesise stable ones.
            id: b.id ?? `hist_${i}`,
            ts: typeof b.ts === "number" ? b.ts : Date.now() - (1000 * (1000 - i)),
          }));
        setBlocks(seeded);
      } catch {
        // 404 / network — leave empty, the user can still chat.
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId, setBlocks]);

  // Auto-scroll on append.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [blocks.length]);

  const submit = () => {
    if (!input.trim()) return;
    send(input);
    setInput("");
  };

  // POST /api/works/:id/abort — kills the running CLI process and lets the
  // turn complete handler broadcast cli_exited so streaming flips off.
  // Pneuma's ChatPanel has the same red-square button when an agent turn
  // is in flight; without it autoviral users have no way to bail out of a
  // long-running thinking pass other than reload-page.
  const abort = async () => {
    if (!streaming) return;
    try {
      await apiFetch(`/api/works/${workId}/abort`, { method: "POST" });
    } catch {
      // server already gone or restart in progress — ignore
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 18px",
          borderBottom: "1px solid var(--divider)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(135deg, var(--accent-hi), var(--accent-lo))",
            display: "grid",
            placeItems: "center",
            color: "var(--accent-fg)",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          ✦
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.015em" }}>{t("chat.agentName")}</div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dimmer)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            {modelLabel}{streaming ? ` · ${t("chat.streaming")}` : ""}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dimmer)",
              letterSpacing: "0.06em",
            }}
          >
            {blocks.length} {t("chat.msgCount")}
          </span>
          <SessionTotals blocks={blocks} />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {loadingHistory && (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-dimmer)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              padding: "20px 8px",
            }}
          >
            {t("chat.loadingHistory")}
          </div>
        )}
        {!loadingHistory && blocks.length === 0 && (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-dimmer)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              padding: "32px 8px",
            }}
          >
            <span
              style={{
                padding: "3px 10px",
                border: "1px solid var(--divider)",
                borderRadius: 999,
              }}
            >
              {t("chat.emptyPrompt")}
            </span>
          </div>
        )}
        {blocks.map((b) => (
          <ChatBlock key={b.id} block={b} onJumpToLocator={onJumpToLocator} />
        ))}
        {streaming && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "var(--surface-0)",
              borderRadius: 10,
              alignSelf: "flex-start",
              maxWidth: "85%",
            }}
          >
            <div style={{ display: "flex", gap: 3 }}>
              <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />
              <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animationDelay: "0.2s" }} />
              <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animationDelay: "0.4s" }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {t("chat.thinking")}
            </span>
          </div>
        )}
      </div>

      {quickActions ?? <QuickActions />}

      {/* Composer */}
      <div style={{ padding: 12, borderTop: "1px solid var(--divider)", flexShrink: 0 }}>
        <div
          style={{
            background: "var(--surface-0)",
            borderRadius: 12,
            border: "1px solid var(--glass-border)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("chat.composerPlaceholder")}
            rows={2}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.5,
              minHeight: 38,
              letterSpacing: "-0.01em",
              width: "100%",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-dimmer)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
              }}
            >
              {t("chat.sendHint")}
            </span>
            <div style={{ flex: 1 }} />
            {streaming ? (
              <button
                onClick={abort}
                style={{
                  width: 28,
                  height: 28,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--spark-red, #c44a4a)",
                  border: "none",
                  borderRadius: 7,
                  color: "#fff",
                  cursor: "pointer",
                  boxShadow: "0 0 12px rgba(196,74,74,0.45)",
                  transition: "background 0.15s",
                  fontWeight: 700,
                }}
                aria-label="Stop"
                title="Stop running turn"
              >
                {/* filled square — pneuma's universal "stop the agent" glyph */}
                ◼
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!input.trim()}
                style={{
                  width: 28,
                  height: 28,
                  display: "grid",
                  placeItems: "center",
                  background: input.trim() ? "var(--accent)" : "var(--surface-2)",
                  border: "none",
                  borderRadius: 7,
                  color: input.trim() ? "var(--accent-fg)" : "var(--text-dimmer)",
                  cursor: input.trim() ? "pointer" : "default",
                  boxShadow: input.trim() ? "0 0 12px var(--accent-glow)" : "none",
                  transition: "background 0.15s",
                  fontWeight: 700,
                }}
                aria-label="Send"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBlock({
  block,
  onJumpToLocator,
}: {
  block: StreamBlock;
  onJumpToLocator: (data: LocatorData) => void;
}) {
  const { type } = block;

  // User → right-side bubble
  if (type === "user") {
    return (
      <div className="slide-up" style={{ alignSelf: "flex-end", maxWidth: "90%" }}>
        <div
          style={{
            padding: "10px 13px",
            background: "linear-gradient(135deg, var(--accent-glow), rgba(168,197,214,0.08))",
            border: "1px solid var(--accent)",
            borderRadius: "14px 14px 4px 14px",
            fontSize: 13,
            lineHeight: 1.55,
            letterSpacing: "-0.005em",
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {block.text}
        </div>
      </div>
    );
  }

  // Tool use → compact mono chip with parameter preview
  if (type === "tool_use") {
    const summary = summarizeToolUse(block.toolName, block.text);
    return (
      <div
        style={{
          alignSelf: "flex-start",
          maxWidth: "90%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--accent)",
          letterSpacing: "0.06em",
          background: "var(--surface-0)",
          border: "1px solid var(--glass-border)",
          borderRadius: 999,
        }}
      >
        <span>▸</span>
        <span
          style={{
            textTransform: "uppercase",
            color: "var(--accent)",
            flexShrink: 0,
          }}
        >
          {summary.tool}
        </span>
        {summary.detail ? (
          <span
            style={{
              color: "var(--text-soft)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {summary.detail}
          </span>
        ) : null}
      </div>
    );
  }

  // Tool result → click to expand the full body
  if (type === "tool_result") {
    return <ToolResultBlock text={block.text} />;
  }

  // Thinking → dimmed italic
  if (type === "thinking") {
    return (
      <div
        style={{
          alignSelf: "flex-start",
          maxWidth: "90%",
          padding: "6px 12px",
          fontSize: 11,
          color: "var(--text-dimmer)",
          fontStyle: "italic",
          letterSpacing: "-0.005em",
          borderLeft: "2px solid var(--divider)",
          opacity: 0.7,
        }}
      >
        {block.text.length > 240 ? block.text.slice(0, 240) + "…" : block.text}
      </div>
    );
  }

  // Default (text / ask_question / unknown) → assistant bubble with markdown
  return (
    <div className="slide-up" style={{ alignSelf: "flex-start", maxWidth: "90%" }}>
      <div
        className="md-bubble"
        style={{
          padding: "10px 13px",
          background: "var(--surface-0)",
          border: "1px solid var(--glass-border)",
          borderRadius: "14px 14px 14px 4px",
          fontSize: 13,
          lineHeight: 1.55,
          letterSpacing: "-0.005em",
          color: "var(--text)",
          wordBreak: "break-word",
        }}
      >
        {segmentTextWithLocators(block.text).map((seg, i) =>
          seg.kind === "markdown" ? (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
              {seg.text}
            </ReactMarkdown>
          ) : (
            <LocatorBlockView
              key={i}
              label={seg.label}
              data={seg.data}
              onJump={onJumpToLocator}
            />
          ),
        )}
      </div>
      {block.usage ? <UsageBadge usage={block.usage} /> : null}
      {block.questions && block.questions.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {block.questions.map((q, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                padding: "6px 10px",
                background: "var(--surface-2)",
                borderRadius: 8,
                color: "var(--text-dim)",
                border: "1px solid var(--glass-border)",
              }}
            >
              {q}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Header-corner running total of cost + tokens across this session's
 * blocks. Sums the per-turn UsageBadge data — when the chat keeps using
 * Opus this is the real cost the user is racking up. Updates live as new
 * turn_complete events fold usage into the latest text block.
 */
function SessionTotals({ blocks }: { blocks: StreamBlock[] }) {
  let cost = 0;
  let inT = 0;
  let outT = 0;
  for (const b of blocks) {
    if (!b.usage) continue;
    cost += b.usage.costUsd ?? 0;
    inT += b.usage.inputTokens ?? 0;
    outT += b.usage.outputTokens ?? 0;
  }
  if (cost === 0 && inT === 0 && outT === 0) return null;
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        color: "var(--text-soft)",
        letterSpacing: "0.04em",
      }}
      title={`session total: ${inT} in / ${outT} out tokens`}
    >
      Σ ${cost.toFixed(3)} · {formatTokens(inT + outT)}
    </span>
  );
}

/** Token count formatter — shows the raw count for small numbers
 *  (otherwise 12 tokens renders as "0.0k", which made the session badge
 *  read like nothing was happening on cheap turns). M / k suffixes for
 *  larger counts. */
function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Pretty-print a tool_use event. Returns (TOOL_NAME, optional detail).
 * Tool names are uppercased CLI conventions; details are
 * - READ / Read: basename of file_path
 * - EDIT / Edit / Write / NotebookEdit: basename of file_path
 * - BASH / Bash: first ~50 chars of `command`
 * - GLOB / GREP: pattern (or pattern+path)
 * - WEBFETCH / WEBSEARCH: url / query
 * - default: collapsed JSON keys
 */
function summarizeToolUse(toolName: string | undefined, raw: string): {
  tool: string;
  detail: string | null;
} {
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // not JSON — fall through with empty input
  }
  const name = (toolName ?? (input.name as string | undefined) ?? "tool").toString();
  const norm = name.toLowerCase();
  const basename = (p: unknown): string => {
    if (typeof p !== "string") return "";
    const m = p.match(/[^/\\]+$/);
    return m ? m[0] : p;
  };
  if (norm === "read" || norm === "edit" || norm === "write" || norm === "notebookedit") {
    return { tool: name, detail: basename(input.file_path ?? input.notebook_path) || null };
  }
  if (norm === "bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    return { tool: name, detail: cmd.length > 70 ? cmd.slice(0, 67) + "…" : cmd || null };
  }
  if (norm === "glob") {
    const p = (input.pattern as string) ?? "";
    return { tool: name, detail: p || null };
  }
  if (norm === "grep") {
    const p = (input.pattern as string) ?? "";
    const where = input.path ? ` in ${basename(input.path)}` : "";
    return { tool: name, detail: (p + where) || null };
  }
  if (norm === "webfetch") {
    return { tool: name, detail: (input.url as string) || null };
  }
  if (norm === "websearch") {
    return { tool: name, detail: (input.query as string) || null };
  }
  // default: show first key:value as a hint
  const k = Object.keys(input)[0];
  if (k && typeof input[k] === "string") {
    const v = input[k] as string;
    return { tool: name, detail: v.length > 60 ? v.slice(0, 57) + "…" : v };
  }
  return { tool: name, detail: null };
}

/**
 * Collapsed-by-default tool result. Click to toggle. Long bodies get
 * truncated to ~600 chars with a "...show more" affordance — agent stdout
 * can be 50+ lines and would otherwise wreck the chat scroll.
 */
function ToolResultBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const firstLine = text.split("\n")[0].slice(0, 80);
  const lineCount = text.split("\n").length;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "90%" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-dim)",
          letterSpacing: "0.06em",
          background: "var(--surface-0)",
          border: "1px solid var(--glass-border)",
          borderRadius: 999,
          cursor: "pointer",
        }}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "✓"}</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 280,
          }}
        >
          {firstLine || "result"}
        </span>
        {lineCount > 1 && !open ? (
          <span style={{ color: "var(--text-dimmer)", marginLeft: 4 }}>
            +{lineCount - 1} lines
          </span>
        ) : null}
      </button>
      {open ? (
        <pre
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "var(--surface-0)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-soft)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {text.length > 4000 ? text.slice(0, 4000) + "\n…[truncated]" : text}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Tiny mono-font badge under an assistant bubble showing what the turn
 * cost. Inspired by pneuma's ChatPanel modelUsage row. Only renders the
 * fields actually present (CLI sometimes omits cost on cached turns).
 */
function UsageBadge({ usage }: { usage: TurnUsage }) {
  const parts: string[] = [];
  if (typeof usage.costUsd === "number") {
    parts.push(`$${usage.costUsd.toFixed(4)}`);
  }
  if (typeof usage.durationMs === "number") {
    const s = usage.durationMs / 1000;
    parts.push(s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`);
  }
  const inT = usage.inputTokens ?? 0;
  const outT = usage.outputTokens ?? 0;
  if (inT || outT) {
    // For per-turn detail keep the asymmetric in→out form (informative for
    // Opus where input dominates), but reuse formatTokens above 1k so a
    // 25k-token turn doesn't blow the chip width.
    const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
    parts.push(`${fmt(inT)}→${fmt(outT)} tok`);
  }
  if (parts.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 4,
        marginLeft: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-dimmer)",
        letterSpacing: "0.04em",
      }}
    >
      {parts.join(" · ")}
    </div>
  );
}
