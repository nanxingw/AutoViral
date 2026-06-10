import { useState, useRef, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { setCoachModel } from "./coachSession";

// PRD-0006 S7 — the SESSION-scoped model switcher for the grounded coach.
//
// Structurally a sibling of Chat/ModelSwitcher (same editorial pill + dropdown,
// same "tier name only, never a version number" honesty rule), but it POSTs to
// the SESSION-scoped /api/coach/model (via setCoachModel) instead of the GLOBAL
// /api/agent/model. That isolation is the whole point: switching the coach's
// tier must NEVER steal the editing agent's tier (and vice-versa). It also reads
// NO global /api/status on mount — the coach tier is its own session state, so
// we default optimistically to opus and let the user flip it.

const SELECTABLE_TIERS = ["fable", "opus", "sonnet"] as const;
type Tier = (typeof SELECTABLE_TIERS)[number];

const TIER_NAME: Record<string, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

function tierName(alias: string): string {
  return TIER_NAME[alias] ?? alias.charAt(0).toUpperCase() + alias.slice(1);
}

export function CoachModelSwitcher({ streaming }: { streaming: boolean }) {
  const t = useT();
  const [alias, setAlias] = useState<string>("opus");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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

  async function pick(tier: Tier) {
    setOpen(false);
    if (tier === alias) return;
    const prev = alias;
    setAlias(tier); // optimistic — the badge flips immediately
    setBusy(true);
    try {
      await setCoachModel(tier); // SESSION-scoped — never the global tier
    } catch {
      setAlias(prev); // rollback on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <span ref={ref} style={wrapStyle}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("explore.coach.modelSwitchAria")}
        title={
          streaming
            ? t("chat.modelSwitch.lockedDuringRun")
            : t("explore.coach.modelSwitchAria")
        }
        style={{
          ...triggerStyle,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {tierName(alias)}
        <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div role="menu" data-testid="coach-model-switch-menu" style={menuStyle}>
          {SELECTABLE_TIERS.map((tier) => {
            const active = tier === alias;
            return (
              <button
                key={tier}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(tier)}
                style={itemStyle(active)}
              >
                <span style={tierNameStyle}>{TIER_NAME[tier]}</span>
                {active && (
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
          <div style={footerStyle}>{t("chat.modelSwitch.alwaysLatest")}</div>
        </div>
      )}
    </span>
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
  minWidth: 168,
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

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm, 6px)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
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
