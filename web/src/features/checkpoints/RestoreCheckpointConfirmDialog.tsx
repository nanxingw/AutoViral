import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";
import { useModalFocus } from "@/hooks/useModalFocus";
import type { Checkpoint } from "./useCheckpoints";

interface Props {
  open: boolean;
  checkpoint: Checkpoint | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * R101 F417 — restore was a one-click `location.reload()` 80 ms after
 * the POST resolved: no preview, no confirm, no diff. Users got the
 * R88 F314 / R95 F372 destructive-surprise mode every time they
 * mis-clicked an item. This gate is the minimum viable safety net —
 * mirrors the RegenerateConfirmDialog / DeleteSlideConfirmDialog
 * template (portal + 0.18s motion + useModalFocus + ESC + backdrop).
 *
 * Long-term F425 (branching: restore-as-new-version) is the real fix;
 * this is the immediate "don't make me regret my mouse twitch" gate.
 */
export function RestoreCheckpointConfirmDialog({
  open,
  checkpoint,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!checkpoint) {
    return createPortal(<AnimatePresence>{null}</AnimatePresence>, document.body);
  }

  const ageText = formatAge(checkpoint.ts, locale, t);
  const kb = (checkpoint.bytes / 1024).toFixed(1);
  const deliverable = checkpoint.deliverable.replace(".yaml", "");

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="restore-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-confirm-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
          }}
          onClick={onCancel}
        >
          <motion.div
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
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
              id="restore-confirm-title"
              style={{
                fontFamily: "var(--font-editorial)",
                fontSize: 22,
                fontStyle: "italic",
                letterSpacing: "-0.015em",
                color: "var(--text)",
                marginBottom: 10,
              }}
            >
              {t("checkpoints.restoreConfirm.title", { age: ageText })}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text-dim)",
                marginBottom: 14,
              }}
            >
              {t("checkpoints.restoreConfirm.body")}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.04em",
                color: "var(--text-dimmer)",
                background: "var(--surface-0)",
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 16,
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 10,
                rowGap: 4,
              }}
            >
              <span style={{ color: "var(--text-soft)" }}>
                {t("checkpoints.restoreConfirm.metaSha")}
              </span>
              <span style={{ color: "var(--accent)" }}>{checkpoint.sha}</span>
              <span style={{ color: "var(--text-soft)" }}>
                {t("checkpoints.restoreConfirm.metaAge")}
              </span>
              <span style={{ color: "var(--text)" }}>{ageText}</span>
              <span style={{ color: "var(--text-soft)" }}>
                {t("checkpoints.restoreConfirm.metaSize")}
              </span>
              <span style={{ color: "var(--text)" }}>
                {kb}KB · {deliverable}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--status-warning, #c89c3e)",
                background: "rgba(200, 156, 62, 0.06)",
                border: "1px solid var(--status-warning, #c89c3e)",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 20,
              }}
            >
              {t("checkpoints.restoreConfirm.warning")}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                data-bare
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
                {t("checkpoints.restoreConfirm.btnCancel")}
              </button>
              <button
                type="button"
                onClick={onConfirm}
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
                {t("checkpoints.restoreConfirm.btnConfirm")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type Translator = ReturnType<typeof useT>;

function formatAge(
  iso: string,
  locale: "zh" | "en",
  t: Translator,
): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 19);
  const now = new Date();
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return t("checkpoints.secondsAgo", { n: sec });
  if (sec < 3600) return t("checkpoints.minutesAgo", { n: Math.round(sec / 60) });
  if (sec < 86400) return t("checkpoints.hoursAgo", { n: Math.round(sec / 3600) });
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}
