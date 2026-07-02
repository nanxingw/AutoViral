import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useCostSummary, formatUsd, type CostSummary } from "@/queries/cost";
import { useChatStore } from "@/features/chat/store";
import { useT, type MessageKey } from "@/i18n/useT";

// B4 (PRD-0010) — per-work cost badge + breakdown panel, shared by Studio and
// Editor top bars (the product decided AGAINST a global cost page — cost lives
// in-context, per work). The badge shows the running total; clicking opens a
// glass panel with the per-kind breakdown, an estimated marker, agent token
// usage, and the accounting-origin note.
//
// The panel is PORTALED to <body> with position:fixed anchored to the badge's
// rect — the top bars sit inside backdrop-filter glass ancestors, which are a
// containing-block trap for position:fixed (see AssetPreviewModal / Editor
// TopBar dropdown precedent, memory: backdrop_filter_portal_trap).

// Known cost kinds → i18n label keys. Unknown kinds fall back to the raw kind
// string so a future ledger `kind` never needs a code change to display.
const KIND_KEYS: Partial<Record<string, MessageKey>> = {
  agent: "cost.kinds.agent",
  image: "cost.kinds.image",
  video: "cost.kinds.video",
  tts: "cost.kinds.tts",
  bgm: "cost.kinds.bgm",
  translate: "cost.kinds.translate",
};

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const monoTag: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-dimmer)",
  border: "1px solid var(--glass-border)",
  borderRadius: 4,
  padding: "0 4px",
  lineHeight: "14px",
};

export function CostBadge({ workId }: { workId: string }) {
  const t = useT();
  const { data } = useCostSummary(workId);
  // Build the summary field-by-field so a partial / not-yet-loaded response
  // (e.g. `{}` before the query resolves) can't crash `.byKind.map`.
  const summary: CostSummary = {
    workId,
    totalUsd: data?.totalUsd ?? 0,
    estimated: data?.estimated ?? false,
    count: data?.count ?? 0,
    byKind: data?.byKind ?? [],
  };

  // Live agent token usage from the chat store (same source as SessionTotals).
  // The ledger summary aggregates USD only, so tokens come from the persisted
  // per-block usage. Empty in Editor / a fresh session → the line hides itself.
  const agentTokens = useChatStore((s) =>
    s.blocks.reduce(
      (n, b) => n + (b.usage?.inputTokens ?? 0) + (b.usage?.outputTokens ?? 0),
      0,
    ),
  );

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const menu = document.querySelector("[data-cost-panel]");
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const kindLabel = (kind: string): string => {
    const key = KIND_KEYS[kind];
    return key ? t(key) : kind;
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-bare
        data-testid="cost-badge"
        aria-label={t("cost.ariaExpand")}
        aria-expanded={open}
        title={t("cost.ariaExpand")}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          padding: "4px 10px",
          borderRadius: 8,
          border: "1px solid var(--glass-border)",
          background: open ? "var(--surface-1)" : "var(--surface-0)",
          color: "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dimmer)",
          }}
        >
          {t("cost.badgeLabel")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            letterSpacing: "-0.01em",
          }}
        >
          {formatUsd(summary.totalUsd)}
        </span>
        {summary.estimated ? (
          <span
            data-testid="cost-badge-estimated"
            title={t("cost.estimatedTag")}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dimmer)",
            }}
          >
            ~
          </span>
        ) : null}
      </button>

      {open && anchorRect
        ? createPortal(
            <div
              data-cost-panel
              data-testid="cost-detail-panel"
              role="dialog"
              aria-label={t("cost.panelTitle")}
              style={{
                position: "fixed",
                top: anchorRect.bottom + 8,
                right: Math.max(12, window.innerWidth - anchorRect.right),
                width: 280,
                maxWidth: "calc(100vw - 24px)",
                background: "var(--surface-1)",
                backdropFilter: "blur(24px) saturate(140%)",
                border: "1px solid var(--glass-border)",
                borderRadius: "var(--radius-lg, 16px)",
                padding: "14px 16px",
                boxShadow: "0 16px 40px rgba(0,0,0,0.34)",
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--text-dim)",
                  }}
                >
                  {t("cost.panelTitle")}
                </span>
                <button
                  type="button"
                  data-bare
                  aria-label={t("cost.close")}
                  onClick={() => setOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-dimmer)",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--divider)",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
                  {t("cost.total")}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-editorial)",
                    fontStyle: "italic",
                    fontSize: 22,
                    color: "var(--accent)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {formatUsd(summary.totalUsd)}
                </span>
              </div>

              {summary.count === 0 ? (
                <div
                  data-testid="cost-empty"
                  style={{
                    fontSize: 12,
                    color: "var(--text-dimmer)",
                    padding: "6px 0",
                    textAlign: "center",
                  }}
                >
                  {t("cost.empty")}
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {summary.byKind.map((g) => (
                    <li
                      key={g.kind}
                      data-testid={`cost-kind-${g.kind}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: "var(--text)",
                        }}
                      >
                        {kindLabel(g.kind)}
                        {g.count > 1 ? (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              color: "var(--text-dimmer)",
                            }}
                          >
                            ×{g.count}
                          </span>
                        ) : null}
                        {g.estimated ? (
                          <span style={monoTag}>{t("cost.estimatedTag")}</span>
                        ) : null}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        {formatUsd(g.usd)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {agentTokens > 0 ? (
                <div
                  data-testid="cost-agent-tokens"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--text-soft)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <span>{t("cost.agentTokens")}</span>
                  <span>{formatTokens(agentTokens)}</span>
                </div>
              ) : null}

              {summary.estimated ? (
                <p
                  data-testid="cost-estimated-note"
                  style={{
                    margin: 0,
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: "var(--text-dimmer)",
                  }}
                >
                  {t("cost.estimatedNote")}
                </p>
              ) : null}

              <p
                data-testid="cost-since-note"
                style={{
                  margin: 0,
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: "var(--text-dimmer)",
                }}
              >
                {t("cost.sinceNote")}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
