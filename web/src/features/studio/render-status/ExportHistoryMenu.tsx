import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import { useExportHistory, type ExportHistoryJob } from "./useExportHistory";
import { filenameOf, toOutputUrl } from "./ExportProgress";
import { revealRenderOutput } from "../services/render";
import { localizeApiError } from "@/i18n/serverError";

type Translator = ReturnType<typeof useT>;

/**
 * S6 (PRD-0012 / issue 027 root-cause 5) — header dropdown listing this
 * work's render history so a finished export is still findable after the
 * ExportProgress modal has been closed. Structurally mirrors
 * CheckpointsMenu (portal-to-body dropdown, anchored to the trigger
 * button, closes on outside click) — same "history list" pattern, just for
 * render jobs instead of yaml snapshots.
 *
 * Every row reuses the exact three affordances ExportProgress ships on its
 * done state (download / show-in-Finder / preview) via the shared
 * filenameOf/toOutputUrl helpers exported from ExportProgress — no
 * duplicated URL-building logic, no risk of the two surfaces drifting.
 * Only status=done rows with an output_path get those affordances; failed
 * rows show the error instead, and in-flight rows (queued/running) show a
 * status label only — the live progress modal is the surface for those.
 */
export function ExportHistoryMenu({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { items, isLoading, isError, error, refetch } = useExportHistory(workId, open);
  const [revealError, setRevealError] = useState<string | null>(null);

  // Anchor + portal — verbatim pattern from CheckpointsMenu (escapes the
  // Panel's stacking/overflow context; see that file's header comment).
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
      const menu = document.querySelector("[data-export-history-menu]");
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const onReveal = async (workIdForReveal: string, filename: string) => {
    setRevealError(null);
    try {
      await revealRenderOutput(workIdForReveal, filename);
    } catch (err: any) {
      setRevealError(err?.message ?? String(err));
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        data-bare
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "5px 11px",
          fontSize: 11,
          borderRadius: 7,
          border: "1px solid var(--glass-border)",
          background: open ? "var(--surface-2)" : "transparent",
          color: "var(--text-soft)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        ⇩ {t("studio.exportHistory.button")}
      </button>
      {open && anchorRect && createPortal(
        <div
          role="menu"
          data-export-history-menu
          style={{
            position: "fixed",
            right: window.innerWidth - anchorRect.right,
            top: anchorRect.bottom + 4,
            minWidth: 300,
            maxHeight: 400,
            overflowY: "auto",
            background: "var(--surface-1, #fff)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            zIndex: 1000,
          }}
        >
          {isLoading && <div style={menuMutedRow}>…</div>}
          {/* codex review (S6 finding, medium) — a 503 (RenderQueue not
              initialized) is a DIFFERENT state from "genuinely zero render
              history" and must not collapse into the same empty copy. */}
          {!isLoading && isError && (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--status-error, #d4756c)",
              }}
            >
              <div>{localizeApiError(error, t)}</div>
              <button
                type="button"
                data-bare
                onClick={() => void refetch()}
                style={{ ...rowActionStyle, marginTop: 6 }}
              >
                {t("studio.exportHistory.retry")}
              </button>
            </div>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <div style={menuMutedRow}>{t("studio.exportHistory.empty")}</div>
          )}
          {items.map((job) => (
            <ExportHistoryRow
              key={job.id}
              job={job}
              workId={workId}
              t={t}
              onReveal={onReveal}
            />
          ))}
          {revealError && (
            <div
              role="alert"
              style={{
                padding: "8px 10px",
                marginTop: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--status-error, #d4756c)",
                background: "rgba(212, 117, 108, 0.08)",
                border: "1px solid var(--status-error, #d4756c)",
                borderRadius: 4,
                lineHeight: 1.5,
              }}
            >
              {revealError}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function statusLabel(status: ExportHistoryJob["status"], t: Translator): string {
  switch (status) {
    case "done":
      return t("studio.exportHistory.statusDone");
    case "failed":
      return t("studio.exportHistory.statusFailed");
    case "running":
      return t("studio.exportHistory.statusRunning");
    case "queued":
      return t("studio.exportHistory.statusQueued");
    case "cancelled":
      return t("studio.exportHistory.statusCancelled");
    default:
      return status;
  }
}

function statusColor(status: ExportHistoryJob["status"]): string {
  switch (status) {
    case "done":
      return "var(--status-done)";
    case "failed":
      return "var(--status-error, #d4756c)";
    case "running":
      return "var(--status-running, var(--accent))";
    default:
      return "var(--text-dimmer)";
  }
}

/** Deterministic mono timestamp (UTC, "YYYY-MM-DD HH:MM") — matches the
 *  mono/uppercase editorial treatment used elsewhere for job metadata (e.g.
 *  ExportProgress's "job <id> · <pct>%" line) without depending on the
 *  viewer's locale/timezone for a stable sort-order-matching read. */
function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function ExportHistoryRow({
  job,
  workId,
  t,
  onReveal,
}: {
  job: ExportHistoryJob;
  workId: string;
  t: Translator;
  onReveal: (workId: string, filename: string) => void;
}) {
  const url = job.outputPath ? toOutputUrl(job.outputPath, workId) : null;
  const filename = job.outputPath ? filenameOf(job.outputPath) : null;
  const canAct = job.status === "done" && !!url && !!filename;

  return (
    <div
      data-testid="export-history-row"
      data-status={job.status}
      style={{
        padding: "8px 10px",
        borderBottom: "1px solid var(--glass-border)",
        opacity: job.status === "failed" || job.status === "cancelled" ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
          }}
        >
          {fmtTimestamp(job.createdAt)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: statusColor(job.status),
          }}
        >
          {statusLabel(job.status, t)}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginTop: 3,
        }}
      >
        <span
          title={filename ?? job.id}
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {filename ?? job.id}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
            flexShrink: 0,
          }}
        >
          {job.presetId ?? t("studio.exportHistory.noPreset")}
        </span>
      </div>
      {canAct ? (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <a
            href={url!}
            download={filename!}
            style={rowActionStyle}
          >
            {t("studio.exportProgress.btnDownload")}
          </a>
          <button
            type="button"
            data-bare
            onClick={() => onReveal(workId, filename!)}
            style={rowActionStyle}
          >
            {t("studio.exportProgress.btnReveal")}
          </button>
          <a
            href={url!}
            target="_blank"
            rel="noopener noreferrer"
            style={rowActionStyle}
          >
            {t("studio.exportProgress.btnPreview")}
          </a>
        </div>
      ) : job.status === "failed" && job.error ? (
        <div
          style={{
            fontSize: 10,
            color: "var(--status-error, #d4756c)",
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={job.error}
        >
          {job.error}
        </div>
      ) : null}
    </div>
  );
}

const menuMutedRow: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dimmer)",
};

const rowActionStyle: React.CSSProperties = {
  padding: "4px 9px",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  border: "1px solid var(--glass-border)",
  background: "transparent",
  color: "var(--text-dim)",
  borderRadius: 6,
  textDecoration: "none",
  cursor: "pointer",
};
