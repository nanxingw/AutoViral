import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";

// C4 (PRD-0010) — the two-level chat header switcher: BACKEND (Claude / Codex)
// on top, model TIER below. It supersedes ModelSwitcher for work-bound chat
// (coach chat keeps its own session-scoped ModelSwitcher).
//
// Backend semantics (the honesty core of C4): claude and codex resume ids are
// NOT interchangeable, so a backend can only be chosen on a FRESH session. An
// ESTABLISHED conversation (`established` prop) renders the non-active backend
// disabled with a tooltip — switching would silently drop context; the user
// must start a NEW session instead.
//
// Tier level: claude rides the alias→latest-version resolution (Fable / Opus /
// Sonnet), switched via POST /api/agent/model exactly as before. The codex tier
// table is maintained INDEPENDENTLY here; we do NOT ship fabricated codex model
// ids — codex model selection is governed by the user's codex CLI config, so
// the codex tier level is rendered as CLI-managed (informational, no no-op
// clickable control).

type Backend = "claude" | "codex";

const CLAUDE_TIERS = ["fable", "opus", "sonnet"] as const;
type ClaudeTier = (typeof CLAUDE_TIERS)[number];

const TIER_NAME: Record<string, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

// Brand labels — identical across locales.
const BACKEND_NAME: Record<Backend, string> = {
  claude: "Claude",
  codex: "Codex",
};

function tierName(alias: string): string {
  return TIER_NAME[alias] ?? alias.charAt(0).toUpperCase() + alias.slice(1);
}

export function BackendSwitcher({
  workId,
  sessionId,
  backend,
  established,
  streaming,
  onBackendSwitched,
}: {
  workId: string;
  /** The active chat session id (backend switch targets this session). */
  sessionId?: string;
  /** The session's current backend. */
  backend: Backend;
  /** True when the session already has a conversation — backend is then locked. */
  established: boolean;
  streaming: boolean;
  /** Called with the new backend after a successful switch (optimistic UI). */
  onBackendSwitched?: (b: Backend) => void;
}) {
  const t = useT();
  const [alias, setAlias] = useState<string>("opus");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Pull the live claude model alias (tier badge) from the server once on mount.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ model?: string }>(`/api/status`)
      .then((d) => {
        if (!cancelled) setAlias((d.model ?? "opus").toLowerCase());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const disabled = streaming || busy;

  async function pickTier(tier: ClaudeTier) {
    setOpen(false);
    if (tier === alias) return;
    const prev = alias;
    setAlias(tier); // optimistic
    setBusy(true);
    try {
      await apiFetch(`/api/agent/model`, {
        method: "POST",
        // W4.5 M8 — target THIS session so the 409 gate + respawn hit the chat the
        // user is actually on (a named session's live bg task must also block).
        body: { model: tier, workId, ...(sessionId ? { sessionId } : {}) },
      });
    } catch {
      setAlias(prev);
    } finally {
      setBusy(false);
    }
  }

  async function pickBackend(next: Backend) {
    // Locked: same backend, or an established session (can't switch — new-session
    // affordance handles that path).
    if (next === backend || established) return;
    setOpen(false);
    setBusy(true);
    try {
      await apiFetch(`/api/works/${workId}/backend`, {
        method: "POST",
        body: { backend: next, ...(sessionId ? { sessionId } : {}) },
      });
      onBackendSwitched?.(next);
    } catch {
      // 409 established / network — the UI keeps the current backend; nothing
      // silently changes (honesty: no optimistic flip we can't guarantee).
    } finally {
      setBusy(false);
    }
  }

  const badge = backend === "codex" ? "Codex" : `Claude · ${tierName(alias)}`;

  return (
    <span ref={ref} style={wrapStyle}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("chat.backendSwitch.aria")}
        title={streaming ? t("chat.backendSwitch.lockedDuringRun") : t("chat.backendSwitch.aria")}
        style={{
          ...triggerStyle,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {badge}
        <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div role="menu" data-testid="backend-switch-menu" style={menuStyle}>
          {/* Level 1 — backend */}
          <div style={groupLabelStyle}>{t("chat.backendSwitch.backendLabel")}</div>
          {(Object.keys(BACKEND_NAME) as Backend[]).map((b) => {
            const active = b === backend;
            // Non-active backend is locked when the session is established.
            const lockSwitch = !active && established;
            return (
              <button
                key={b}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={lockSwitch}
                onClick={() => pickBackend(b)}
                title={lockSwitch ? t("chat.backendSwitch.lockedExisting") : undefined}
                style={itemStyle(active, lockSwitch)}
              >
                <span style={tierNameStyle}>{BACKEND_NAME[b]}</span>
                {active && <Check />}
              </button>
            );
          })}

          {/* Level 2 — model tier for the active backend */}
          <div style={{ ...groupLabelStyle, marginTop: 6 }}>{t("chat.backendSwitch.tierLabel")}</div>
          {backend === "claude" ? (
            CLAUDE_TIERS.map((tier) => {
              const active = tier === alias;
              return (
                <button
                  key={tier}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => pickTier(tier)}
                  style={itemStyle(active, false)}
                >
                  <span style={tierNameStyle}>{TIER_NAME[tier]}</span>
                  {active && <Check />}
                </button>
              );
            })
          ) : (
            // codex tier table (independently maintained) — CLI-managed, no
            // fabricated model ids shipped.
            <div style={footerStyle}>{t("chat.backendSwitch.codexManaged")}</div>
          )}

          <div style={footerStyle}>
            {established
              ? t("chat.backendSwitch.lockedExisting")
              : t("chat.backendSwitch.newSessionHint")}
          </div>
        </div>
      )}
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const wrapStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  verticalAlign: "middle",
};

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dimmer)",
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  minWidth: 184,
  zIndex: 60,
  display: "flex",
  flexDirection: "column",
  padding: 4,
  borderRadius: "var(--radius-md, 10px)",
  background: "var(--surface-1)",
  border: "1px solid var(--glass-border)",
  boxShadow: "0 18px 44px rgba(0,0,0,0.4)",
  backdropFilter: "blur(24px) saturate(140%)",
  WebkitBackdropFilter: "blur(24px) saturate(140%)",
};

const groupLabelStyle: React.CSSProperties = {
  padding: "4px 10px 2px",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-dimmer)",
};

function itemStyle(active: boolean, locked: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "none",
    cursor: locked ? "not-allowed" : "pointer",
    textAlign: "left",
    opacity: locked ? 0.45 : 1,
    background: active ? "rgba(168, 197, 214, 0.12)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-soft)",
  };
}

const tierNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.01em",
};

const footerStyle: React.CSSProperties = {
  padding: "6px 10px 4px",
  marginTop: 2,
  borderTop: "1px solid var(--glass-border)",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.04em",
  color: "var(--text-dimmer)",
  lineHeight: 1.4,
};
