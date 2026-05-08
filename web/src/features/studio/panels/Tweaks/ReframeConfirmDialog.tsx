import { createPortal } from "react-dom";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "@/i18n/useT";

export interface ReframeClipSummary {
  id: string;
  src: string;
  label?: string;
}

interface Props {
  open: boolean;
  presetLabel: string;
  fromAspect: string;
  toAspect: string;
  clips: ReframeClipSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Phase 6.D — D3 confirmation modal. Lists every video clip that would be
 * reframed when the chosen platform preset is applied. On confirm: caller
 * dispatches `applyPlatformPreset` + parallel `/api/video/reframe` calls. On
 * cancel: caller does nothing (D6 — full no-op, neither preset metadata nor
 * clips change).
 *
 * ESC and backdrop click both fire `onCancel`. Portals to `document.body` so
 * the floating Tweaks panel (240px wide) doesn't clip the modal.
 */
export function ReframeConfirmDialog({
  open,
  presetLabel,
  fromAspect,
  toAspect,
  clips,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="reframe-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reframe-dialog-title"
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
          id="reframe-dialog-title"
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 22,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
            marginBottom: 8,
          }}
        >
          {(() => {
            const tpl = t("studio.reframeDialog.title", { preset: "​" });
            const [before, after] = tpl.split("​");
            return (
              <>
                {before}
                <span style={{ color: "var(--accent-hi)" }}>{presetLabel}</span>
                {after}
              </>
            );
          })()}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            marginBottom: 16,
          }}
        >
          {t("studio.reframeDialog.subtitle", { from: fromAspect, to: toAspect })}
        </div>
        {clips.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dimmer)", padding: "12px 0" }}>
            {t("studio.reframeDialog.emptyClips")}
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px 0" }}>
            {clips.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--surface-0)",
                  marginBottom: 4,
                  fontSize: 13,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{c.label ?? c.id}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dimmer)", fontSize: 11 }}>
                  {c.src.split("/").pop()}
                </span>
              </li>
            ))}
          </ul>
        )}
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
            {t("studio.reframeDialog.btnCancel")}
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
            {t("studio.reframeDialog.btnConfirm")}
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
