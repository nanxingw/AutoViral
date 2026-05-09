import { useEffect } from "react";
import { useToastStore, describeError } from "@/stores/toast";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/useT";

/**
 * Round 32 — global toast layer. Renders the toast queue + listens on
 * window.unhandledrejection so any escaped promise rejection (mutations
 * missing a try/catch, fire-and-forget side effects, etc.) becomes a
 * visible toast instead of a silent console.error.
 *
 * Mounted once at App.tsx level — cooperates with R20/R21/R22's inline
 * error UI: callers that handle their own errors don't generate
 * unhandledrejection events, so no toast fires there. The toast is a
 * **last-resort** safety net for paths the developer forgot.
 */
export function ToastViewport() {
  const entries = useToastStore((s) => s.entries);
  const dismiss = useToastStore((s) => s.dismiss);
  const push = useToastStore((s) => s.push);
  const t = useT();

  useEffect(() => {
    // Cast t to the looser shape describeError expects (it does its own
    // missing-key fallback so any string key is safe to pass).
    const tt = t as unknown as (key: string, params?: Record<string, string | number>) => string;

    function onUnhandled(e: PromiseRejectionEvent) {
      const { message, detail } = describeError(e.reason, tt);
      push({
        variant: "error",
        message,
        detail,
        ttlMs: 8000,
      });
      // Don't preventDefault — let DevTools still log the trace for
      // debugging. The toast is additive UI, not a swallow.
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, [push, t]);

  // Auto-dismiss timer per entry. We track ids in a ref-style closure
  // through entries, but useEffect with entries dep is simpler and
  // correct: every render reschedules timers. The dedupe in the store
  // means re-renders rarely add new entries.
  useEffect(() => {
    const timers: number[] = [];
    for (const e of entries) {
      if (e.ttlMs > 0) {
        const elapsed = Date.now() - e.createdAt;
        const remaining = Math.max(0, e.ttlMs - elapsed);
        const id = window.setTimeout(() => dismiss(e.id), remaining);
        timers.push(id);
      }
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [entries, dismiss]);

  // R40 a11y: don't early-return when entries empty. Live regions only
  // announce when a child appears IF the region was already in the DOM.
  // Mounting the whole tree the moment a toast arrives can race the
  // assistive tech's polling. Keep the region permanently mounted; let
  // empty state render an empty container with no visible footprint.
  return (
    <div
      role="region"
      aria-label={t("toast.viewportAriaLabel" as MessageKey)}
      // role="region" does NOT imply aria-live (unlike role="status" /
      // role="alert"). Set explicitly so screen readers track child
      // additions. Polite default; per-toast variant escalates to
      // assertive for errors.
      aria-live="polite"
      aria-relevant="additions"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        display: entries.length === 0 ? "none" : "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1100,
        maxWidth: "min(420px, calc(100vw - 32px))",
      }}
    >
      {entries.map((e) => (
        <div
          key={e.id}
          // R40: error toasts upgrade to role="alert" (assertive) so
          // screen readers interrupt current speech. Info toasts stay
          // role="status" (polite) — non-urgent feedback shouldn't talk
          // over the user.
          role={e.variant === "error" ? "alert" : "status"}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border:
              e.variant === "error"
                ? "1px solid var(--status-error, #d4756c)"
                : "1px solid var(--glass-border)",
            background:
              e.variant === "error"
                ? "rgba(212, 117, 108, 0.08)"
                : "var(--surface-1)",
            color:
              e.variant === "error"
                ? "var(--status-error, #d4756c)"
                : "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            backdropFilter: "blur(12px)",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ wordBreak: "break-word" }}>{e.message}</div>
            {e.detail && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-dimmer)",
                }}
              >
                {e.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(e.id)}
            data-bare
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "currentColor",
              padding: 0,
              fontSize: 14,
              lineHeight: 1,
              opacity: 0.6,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
