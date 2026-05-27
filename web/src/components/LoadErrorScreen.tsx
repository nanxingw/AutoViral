import { useState } from "react";
import { useT } from "@/i18n/useT";

/**
 * #61 — shared failure screen for work-load errors (Studio composition /
 * Editor carousel). Mirrors the ErrorBoundary failure-state pattern: a
 * human-readable headline, plus the raw server detail (e.g. a ZodError JSON
 * dump) tucked into a DEFAULT-COLLAPSED "technical details" panel with a
 * "copy diagnostic" button — never as the headline itself.
 *
 * Before this, `composition_unreadable`'s `{detail}` interpolated the full
 * ZodError JSON straight into the user-facing sentence, so a non-technical
 * creator saw a screen of `[{ "code": "invalid_union", ... }]`.
 */
export function LoadErrorScreen({
  title,
  message,
  detail,
  helpText,
}: {
  title: string;
  message: string;
  /** Raw technical detail (ZodError JSON etc.). Collapsible; omitted when "". */
  detail?: string;
  helpText: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // Match ErrorBoundary F499: dev sees the detail expanded for fast debug;
  // prod keeps it collapsed so a Zod dump isn't on-screen by default.
  const isDev = !!import.meta.env?.DEV;
  const hasDetail = !!detail && detail.trim().length > 0;

  const handleCopyDiagnostic = async () => {
    const payload = {
      message,
      detail: detail ?? null,
      url: globalThis.location?.href ?? null,
      userAgent: globalThis.navigator?.userAgent ?? null,
      timestamp: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Clipboard unavailable (http://, sandboxed) — open the blob so the
      // user can copy manually. Same fallback as ErrorBoundary F504.
      const blob = new Blob([text], { type: "application/json" });
      window.open(URL.createObjectURL(blob), "_blank");
    }
  };

  return (
    <div
      role="alert"
      style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--accent)", maxWidth: 720 }}
    >
      <h2>{title}</h2>
      <p style={{ color: "var(--text)", lineHeight: 1.6 }}>{message}</p>

      {hasDetail && (
        <details
          open={isDev}
          data-testid="loaderror-details"
          style={{
            margin: "16px 0",
            padding: "8px 12px",
            background: "var(--surface-1)",
            border: "1px dashed var(--glass-border)",
            borderRadius: 6,
          }}
        >
          <summary
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-dimmer)",
              cursor: "pointer",
            }}
          >
            {t("errorBoundary.detailsLabel")}
          </summary>
          <pre
            data-testid="loaderror-detail-pre"
            style={{
              marginTop: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {detail}
          </pre>
          <button
            type="button"
            data-testid="loaderror-copy"
            onClick={handleCopyDiagnostic}
            aria-live="polite"
            style={{
              marginTop: 8,
              padding: "6px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              border: "1px dashed var(--glass-border)",
              background: "transparent",
              color: copied ? "var(--accent)" : "var(--text-dimmer)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {copied ? t("errorBoundary.copyDone") : t("errorBoundary.copyDiagnostic")}
          </button>
        </details>
      )}

      <p style={{ fontSize: 12, opacity: 0.7 }}>{helpText}</p>
    </div>
  );
}
