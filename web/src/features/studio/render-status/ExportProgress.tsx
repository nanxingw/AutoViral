import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRenderJob, type RenderJobView } from "./useRenderJob";
import { useT } from "@/i18n/useT";
import { useModalFocus } from "@/hooks/useModalFocus";
import { revealRenderOutput } from "../services/render";

const STAGES = ["render", "duck", "loudnorm", "burn", "encode"] as const;
type Stage = (typeof STAGES)[number];

const TERMINAL: ReadonlyArray<RenderJobView["status"]> = ["done", "failed", "cancelled"];

export interface ExportProgressProps {
  jobId: string | null;
  /** R43 — needed to construct the served URL for outputPath. The
   *  pipeline writes to /Users/.../works/<id>/output/<file>; the
   *  browser can fetch it via /api/works/<id>/assets/output/<file>. */
  workId?: string;
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
/** R43 — extract just the basename from an absolute path. */
function filenameOf(absolutePath: string): string {
  const parts = absolutePath.split("/");
  return parts[parts.length - 1] ?? absolutePath;
}

/**
 * R43 — derive a browser-fetchable URL from the absolute disk path the
 * worker writes. Server exposes /api/works/<id>/assets/output/<file>
 * (api.ts:1245); we extract the basename and join under workId. Returns
 * null if the path doesn't look like a work output (defensive — link is
 * just hidden in that case rather than 404'ing).
 */
function toOutputUrl(absolutePath: string, workId: string | undefined): string | null {
  if (!workId) return null;
  const filename = filenameOf(absolutePath);
  if (!filename) return null;
  return `/api/works/${workId}/assets/output/${encodeURIComponent(filename)}`;
}

export function ExportProgress({ jobId, workId, onClose, onRetry }: ExportProgressProps) {
  const { job, cancel, cancelError } = useRenderJob(jobId);
  const t = useT();
  // R43 — surface reveal failures inline. Most likely cause is the user
  // running the dev server in a non-supported platform (returns 501) or
  // the output file getting moved between done event and reveal click.
  const [revealError, setRevealError] = useState<string | null>(null);
  // R41: focus management. Without this, opening Export modal during a
  // 5-min render leaves keyboard users unable to reach the Cancel button.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(jobId !== null, dialogRef);

  useEffect(() => {
    if (!job) return;
    // R43 — done no longer auto-closes. The previous 1500ms auto-close
    // meant users saw "Export complete" briefly, then the modal vanished
    // with no link / button to open the produced file. Now the modal
    // stays put on done with an "open output" affordance the user
    // dismisses manually. Cancelled still auto-closes (no useful follow-
    // up state to show).
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
        ref={dialogRef}
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

        {/* R43 — done state surfaces three explicit actions:
              1. 下载   ─ <a download> forces save-to-Downloads
              2. 在 Finder 显示 ─ POST /api/render/reveal → open -R (Mac)
              3. 预览   ─ open in tab for inline playback
            Earlier we shipped only "open" which was ambiguous — users
            asked "怎么下载这个视频". 现在三个动作含义都明确。 */}
        {status === "done" && job?.outputPath && toOutputUrl(job.outputPath, workId) ? (
          <div
            data-testid="export-output-row"
            style={{
              marginTop: 16,
              padding: "12px 14px",
              background: "var(--surface-0)",
              border: "1px solid var(--accent-lo, var(--glass-border))",
              borderRadius: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              title={job.outputPath}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--text)",
                fontSize: 12,
              }}
            >
              {filenameOf(job.outputPath)}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {/* Primary action: 下载. The `download` attribute on a
                  same-origin <a> tells the browser to save the response
                  body as a file (with the supplied filename) instead of
                  navigating to it / playing it inline. Mac and Windows
                  both honor this. The `download="..."` value overrides
                  the filename Chrome would otherwise infer from the URL. */}
              <a
                href={toOutputUrl(job.outputPath, workId) ?? "#"}
                download={filenameOf(job.outputPath)}
                style={{
                  padding: "6px 12px",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  border: "1px solid var(--accent)",
                  background: "var(--accent-glow)",
                  color: "var(--accent-hi)",
                  borderRadius: 6,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                ↓ {t("studio.exportProgress.btnDownload")}
              </a>
              {workId ? (
                <button
                  type="button"
                  data-bare
                  onClick={async () => {
                    setRevealError(null);
                    try {
                      await revealRenderOutput(workId, filenameOf(job.outputPath!));
                    } catch (err: any) {
                      setRevealError(err?.message ?? String(err));
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    border: "1px solid var(--glass-border)",
                    background: "transparent",
                    color: "var(--text-dim)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {t("studio.exportProgress.btnReveal")}
                </button>
              ) : null}
              <a
                href={toOutputUrl(job.outputPath, workId) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "6px 12px",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  border: "1px solid var(--glass-border)",
                  background: "transparent",
                  color: "var(--text-dim)",
                  borderRadius: 6,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                {t("studio.exportProgress.btnPreview")}
              </a>
            </div>
            {revealError ? (
              <div
                role="alert"
                style={{
                  fontSize: 10,
                  color: "var(--status-error, #d4756c)",
                  lineHeight: 1.5,
                }}
              >
                {revealError}
              </div>
            ) : null}
            <div
              title={job.outputPath}
              style={{
                fontSize: 10,
                color: "var(--text-dimmer)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {job.outputPath}
            </div>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 18,
          }}
        >
          {/* Cancel turns into Close after a terminal status — same slot,
              different verb, so users always have a way out without
              having to find an X corner glyph. */}
          <button
            type="button"
            onClick={() => (isTerminal ? onClose() : void cancel())}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: "var(--text-dim)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {isTerminal
              ? t("studio.exportProgress.btnClose")
              : t("studio.exportProgress.btnCancel")}
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
