import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";
import { useCheckpoints, type Checkpoint } from "./useCheckpoints";
import { RestoreCheckpointConfirmDialog } from "./RestoreCheckpointConfirmDialog";

type Translator = ReturnType<typeof useT>;

/**
 * Header dropdown listing yaml snapshots for the current work. Click an
 * item → confirm dialog → restore → page reload (so every page-level
 * yaml load happens fresh).
 *
 * R101 F417 — single-click restore used to be destructive: 80 ms after
 * the POST resolved, location.reload() blew away all unsaved scratch
 * state (chat draft, panel widths, TabContent state). Now an explicit
 * `RestoreCheckpointConfirmDialog` (mirrors RegenerateConfirmDialog /
 * DeleteSlideConfirmDialog) gates the destructive write.
 *
 * R101 F422 — for years the header comment promised "users can press
 * the button when closed to take a manual snapshot before a risky
 * chat," but the onClick implementation only toggled the dropdown. The
 * "📷 Take snapshot now" row at the top of the menu finally honors
 * that promise via `useCheckpoints.createManual` → the server-side
 * POST endpoint that has existed all along.
 *
 * R101 F426 — restore errors are now routed through
 * `localizeApiError` inside `useCheckpoints` (server errorCode → i18n
 * key), so ZH users no longer see raw English "Checkpoint not found
 * or invalid name" strings.
 */
export function CheckpointsMenu({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const {
    items,
    isLoading,
    restore,
    restoring,
    restoreError,
    createManual,
    creatingSnapshot,
    snapshotError,
    snapshotResult,
    clearSnapshotStatus,
  } = useCheckpoints(workId, open);
  const list = { isLoading, data: { items } };

  // R101 F417 — pending checkpoint awaits user confirmation. Null means
  // dialog is closed. Mirrors AITab + Filmstrip confirm flow.
  const [pendingRestore, setPendingRestore] = useState<Checkpoint | null>(null);

  // R22: previously this called `setOpen(false)` immediately on click — but
  // if restore later rejected, the dropdown was already closed and the user
  // never saw the error. Now we keep it open during the request so:
  //   - success path: page reload erases dropdown anyway
  //   - failure path: dropdown stays open, restoreError renders inline
  const onPickItem = (c: Checkpoint) => {
    if (restoring) return;
    setPendingRestore(c);
  };

  const onConfirmRestore = () => {
    if (!pendingRestore) return;
    const file = pendingRestore.file;
    setPendingRestore(null);
    void restore(file);
  };

  // Anchor + portal: previously the dropdown was `position:absolute` inside
  // a wrapper sitting in a react-resizable-panels Panel, which creates a
  // stacking/overflow context that visually clipped the menu (the absolute
  // child rendered but was hidden behind the LIBRARY panel below). Solution:
  // render the menu in a portal to <body> with `position:fixed`, anchored to
  // the trigger button's bounding rect — escapes both the stacking context
  // and any ancestor `overflow:hidden`.
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

  // Close on outside click (clicking outside both trigger and menu).
  useLayoutEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const menu = document.querySelector('[data-checkpoints-menu]');
      if (menu?.contains(target)) return;
      // The confirm dialog is portaled outside the menu — don't close
      // the menu when the user clicks anywhere inside the dialog (or its
      // backdrop), otherwise the dialog's own onCancel handler races
      // this close-on-outside listener.
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="restore-confirm-title"]');
      if (dialog?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // R101 F422 — clear status after 3s so the "saved · v3" hint doesn't
  // linger forever, but still long enough for the user to read it.
  useLayoutEffect(() => {
    if (!snapshotResult && !snapshotError) return;
    const id = window.setTimeout(() => {
      clearSnapshotStatus();
    }, 3200);
    return () => window.clearTimeout(id);
  }, [snapshotResult, snapshotError, clearSnapshotStatus]);

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
        ↻ {t("checkpoints.button")}
      </button>
      {open && anchorRect && createPortal(
        <div
          role="menu"
          data-checkpoints-menu
          style={{
            position: "fixed",
            right: window.innerWidth - anchorRect.right,
            top: anchorRect.bottom + 4,
            minWidth: 280,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--surface-1, #fff)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            zIndex: 1000,
          }}
        >
          {/* R101 F422 — manual "take snapshot now" trigger sits at the
              top so it's the first thing the user sees when they reach
              for "I'm about to do something risky, save first." */}
          <button
            type="button"
            onClick={() => {
              void createManual();
            }}
            disabled={creatingSnapshot}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 8,
              alignItems: "center",
              padding: "8px 10px",
              border: "none",
              borderBottom: "1px solid var(--glass-border)",
              background: "transparent",
              cursor: creatingSnapshot ? "wait" : "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text)",
              borderRadius: 4,
              textAlign: "left",
              marginBottom: 4,
            }}
            onMouseEnter={(e) => {
              if (!creatingSnapshot) {
                e.currentTarget.style.background = "var(--surface-2)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ color: "var(--accent)" }} aria-hidden>📷</span>
            <span style={{ color: "var(--text)" }}>
              {creatingSnapshot
                ? t("checkpoints.snapshotInProgress")
                : t("checkpoints.takeSnapshot")}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-dimmer)" }}>
              {/* keyboard-shortcut placeholder; F423 will wire global hotkey */}
              {""}
            </span>
          </button>
          {snapshotResult && !snapshotError && (
            <div
              role="status"
              aria-live="polite"
              style={{
                ...menuMutedRow,
                color: "var(--accent)",
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              {snapshotResult === "created"
                ? t("checkpoints.snapshotCreated")
                : t("checkpoints.snapshotUnchanged")}
            </div>
          )}
          {snapshotError && (
            <div
              role="alert"
              style={{
                padding: "8px 10px",
                marginBottom: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--status-error, #d4756c)",
                background: "rgba(212, 117, 108, 0.08)",
                border: "1px solid var(--status-error, #d4756c)",
                borderRadius: 4,
                lineHeight: 1.5,
              }}
            >
              {t("checkpoints.snapshotFailed", { msg: snapshotError })}
            </div>
          )}
          {list.isLoading && (
            <div style={menuMutedRow}>{/* loading shim */}…</div>
          )}
          {list.data && list.data.items.length === 0 && (
            <div style={menuMutedRow}>{t("checkpoints.empty")}</div>
          )}
          {list.data?.items.map((c) => (
            <button
              key={c.file}
              type="button"
              onClick={() => onPickItem(c)}
              disabled={restoring === c.file}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                cursor: restoring === c.file ? "wait" : "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text)",
                borderRadius: 4,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ color: "var(--accent)" }}>{c.sha}</span>
              <span style={{ color: "var(--text-soft)" }}>
                {fmtTs(c.ts, locale, t)} · {c.deliverable.replace(".yaml", "")}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-dimmer)" }}>
                {(c.bytes / 1024).toFixed(1)}KB
              </span>
            </button>
          ))}
          {restoreError && (
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
              {t("checkpoints.restoreFailed", { msg: restoreError })}
            </div>
          )}
        </div>,
        document.body,
      )}
      <RestoreCheckpointConfirmDialog
        open={pendingRestore !== null}
        checkpoint={pendingRestore}
        onConfirm={onConfirmRestore}
        onCancel={() => setPendingRestore(null)}
      />
    </div>
  );
}

// e2e-report F57: locale + t passed in so the relative-time fallbacks and the
// absolute-date format both follow the app locale rather than OS / hardcoded EN.
function fmtTs(iso: string, locale: "zh" | "en", t: Translator): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 19);
  const now = new Date();
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return t("checkpoints.secondsAgo", { n: sec });
  if (sec < 3600) return t("checkpoints.minutesAgo", { n: Math.round(sec / 60) });
  if (sec < 86400) return t("checkpoints.hoursAgo", { n: Math.round(sec / 3600) });
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

const menuMutedRow: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dimmer)",
};
