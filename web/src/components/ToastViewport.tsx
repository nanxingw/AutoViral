import { useEffect } from "react";
import { useToastStore, describeError } from "@/stores/toast";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/useT";
import styles from "./ToastViewport.module.css";

/**
 * Round 32 — global toast layer. Renders the toast queue + listens on
 * window.unhandledrejection so any escaped promise rejection (mutations
 * missing a try/catch, fire-and-forget side effects, etc.) becomes a
 * visible toast instead of a silent console.error.
 *
 * Task 5.1 — refactored to editorial cool-steel glass:
 *  - css-module driven (no large inline style soup)
 *  - kind-dot indicator on the left (success/warn/error/info)
 *  - mono font for short status text + 24px blur saturate(140%) glass surface
 *  - slide-up entrance with prefers-reduced-motion override
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
      className={styles.viewport}
      data-empty={entries.length === 0 ? "true" : "false"}
      role="region"
      aria-label={t("toast.viewportAriaLabel" as MessageKey)}
      // role="region" does NOT imply aria-live (unlike role="status" /
      // role="alert"). Set explicitly so screen readers track child
      // additions. Polite default; per-toast variant escalates to
      // assertive for errors.
      aria-live="polite"
      aria-relevant="additions"
    >
      {entries.map((e) => (
        <div
          key={e.id}
          className={styles.toast}
          data-variant={e.variant}
          // R40: error toasts upgrade to role="alert" (assertive) so
          // screen readers interrupt current speech. Other variants stay
          // role="status" (polite).
          role={e.variant === "error" ? "alert" : "status"}
        >
          <span className={styles.dot} aria-hidden="true" />
          <div className={styles.body}>
            <div className={styles.message}>{e.message}</div>
            {e.detail && <div className={styles.detail}>{e.detail}</div>}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(e.id)}
            data-bare
            className={styles.close}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
