import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRenderJob, type RenderJobView } from "./useRenderJob";
import { useT } from "@/i18n/useT";

const STAGES = ["render", "duck", "loudnorm", "burn", "encode"] as const;
type Stage = (typeof STAGES)[number];

const TERMINAL: ReadonlyArray<RenderJobView["status"]> = ["done", "failed", "cancelled"];

export interface ExportProgressProps {
  jobId: string | null;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * Phase 7.D — modal that tracks a single render job.
 *
 * Per D8:
 *   • status=done   → shows "Export complete" success state for 1500ms then auto-closes.
 *   • status=failed → stays open with Retry button + scrollable log.
 *   • status=cancelled → closes immediately.
 *   • Cancel button enabled iff status ∈ {queued, running}.
 *
 * a11y mirrors Phase 5.C / 6.D pattern: portal to document.body,
 * role="dialog", aria-modal="true", aria-labelledby on title id.
 */
export function ExportProgress({ jobId, onClose, onRetry }: ExportProgressProps) {
  const { job, cancel, cancelError } = useRenderJob(jobId);
  const t = useT();

  useEffect(() => {
    if (!job) return;
    if (job.status === "done") {
      const tid = setTimeout(onClose, 1500);
      return () => clearTimeout(tid);
    }
    if (job.status === "cancelled") {
      onClose();
    }
  }, [job?.status, onClose]);

  if (!jobId) return null;

  const status = job?.status ?? "queued";
  const isTerminal = TERMINAL.includes(status);
  const activeStage: Stage | null = (job?.stage as Stage | undefined) ?? null;
  const activeIdx = activeStage ? STAGES.indexOf(activeStage) : -1;

  const title =
    status === "done"
      ? t("studio.exportProgress.titleDone")
      : status === "failed"
        ? t("studio.exportProgress.titleFailed")
        : status === "cancelled"
          ? t("studio.exportProgress.titleCancelled")
          : t("studio.exportProgress.titleRendering");

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-progress-title"
      aria-describedby="export-progress-desc"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxHeight: "76vh",
          overflow: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--glass-border)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
        }}
      >
        <div
          id="export-progress-title"
          // R40 a11y: render title transitions (queued → running → done /
          // failed / cancelled) audibly. Without aria-live the screen
          // reader announces the title only once at dialog open via
          // aria-labelledby, then goes silent for the remainder of a
          // 5-min render. Polite is correct — progress updates shouldn't
          // interrupt the user's other actions.
          aria-live="polite"
          aria-atomic="true"
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 22,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div
          id="export-progress-desc"
          style={{
            fontSize: 11,
            color: "var(--text-dimmer)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 18,
          }}
        >
          job {jobId.slice(0, 12)} · {Math.round((job?.progress ?? 0) * 100)}%
        </div>

        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {STAGES.map((s, i) => {
            const active = activeStage === s && status === "running";
            const past =
              status === "done" || (activeIdx >= 0 && i < activeIdx);
            const colour = active
              ? "var(--accent)"
              : past
                ? "var(--accent-lo, var(--accent))"
                : "var(--text-dimmer)";
            return (
              <li
                key={s}
                data-testid={`stage-${s}`}
                data-active={active ? "true" : "false"}
                data-past={past ? "true" : "false"}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: colour,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: colour,
                    opacity: active ? 1 : 0.5,
                  }}
                />
                <span>{s}</span>
              </li>
            );
          })}
        </ul>

        <div
          aria-hidden
          style={{
            height: 4,
            background: "var(--surface-0)",
            borderRadius: 2,
            marginTop: 18,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.round((job?.progress ?? 0) * 100)}%`,
              height: "100%",
              background:
                status === "failed" ? "var(--status-error, #d4756c)" : "var(--accent)",
              transition: "width 200ms ease",
            }}
          />
        </div>

        {job?.error ? (
          <pre
            style={{
              marginTop: 14,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--status-error, #d4756c)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
              padding: "8px 10px",
              background: "var(--surface-0)",
              borderRadius: 6,
            }}
          >
            {job.error}
          </pre>
        ) : null}

        {job && job.log.length > 0 ? (
          <details style={{ marginTop: 12 }}>
            <summary
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              {t("studio.exportProgress.logSummary", { count: job.log.length })}
            </summary>
            <pre
              style={{
                fontSize: 10,
                color: "var(--text-dim)",
                maxHeight: 160,
                overflow: "auto",
                marginTop: 6,
              }}
            >
              {job.log.map((l) => `[${l.level}] ${l.msg}`).join("\n")}
            </pre>
          </details>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={isTerminal}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: isTerminal ? "var(--text-dimmer)" : "var(--text-dim)",
              borderRadius: 6,
              cursor: isTerminal ? "not-allowed" : "pointer",
              opacity: isTerminal ? 0.5 : 1,
            }}
          >
            {t("studio.exportProgress.btnCancel")}
          </button>
          {status === "failed" ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                border: "1px solid var(--accent)",
                background: "var(--accent-glow)",
                color: "var(--accent-hi)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {t("studio.exportProgress.btnRetry")}
            </button>
          ) : null}
        </div>
        {cancelError && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--status-error, #d4756c)",
              background: "rgba(212, 117, 108, 0.08)",
              border: "1px solid var(--status-error, #d4756c)",
              borderRadius: 6,
              lineHeight: 1.5,
            }}
          >
            {t("studio.exportProgress.cancelFailed", { msg: cancelError })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
