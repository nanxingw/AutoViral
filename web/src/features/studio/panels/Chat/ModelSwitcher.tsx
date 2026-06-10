import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";

// Inline model-tier switcher for the chat header.
//
// Design ported in spirit from pandazki/pneuma-skills' ModelSwitcher (a pill +
// dropdown of tiers), adapted to AutoViral's editorial/glass idiom.
//
// We show ONLY the tier — "Opus" / "Sonnet" — never a version number. The config
// stores a bare alias (opus/sonnet) and the Claude Code CLI resolves it to the
// LATEST member of that family at spawn time. So "Opus" always means "the newest
// Opus"; pinning/showing "4.7" would be a lie that goes stale every release.
// The user picks a tier and forever rides the latest version of it.

const SELECTABLE_TIERS = ["fable", "opus", "sonnet"] as const;
type Tier = (typeof SELECTABLE_TIERS)[number];

// Brand names — identical across locales. `haiku` is not selectable but is kept
// here so the badge still renders sanely if config.model is ever set to it.
const TIER_NAME: Record<string, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

function tierName(alias: string): string {
  return TIER_NAME[alias] ?? alias.charAt(0).toUpperCase() + alias.slice(1);
}

export function ModelSwitcher({
  workId,
  streaming,
}: {
  workId: string;
  streaming: boolean;
}) {
  const t = useT();
  const [alias, setAlias] = useState<string>("opus");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Pull the live model alias from the server once on mount. Falls back to opus
  // (the code default) if the call fails.
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

  async function pick(tier: Tier) {
    setOpen(false);
    if (tier === alias) return;
    const prev = alias;
    setAlias(tier); // optimistic — the badge flips immediately
    setBusy(true);
    try {
      await apiFetch(`/api/agent/model`, {
        method: "POST",
        body: { model: tier, workId },
      });
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
        aria-label={t("chat.modelSwitch.aria")}
        title={
          streaming
            ? t("chat.modelSwitch.lockedDuringRun")
            : t("chat.modelSwitch.aria")
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
        <div role="menu" data-testid="model-switch-menu" style={menuStyle}>
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
