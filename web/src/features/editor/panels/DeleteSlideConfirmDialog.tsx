import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "@/i18n/useT";
import { useModalFocus } from "@/hooks/useModalFocus";

interface Props {
  open: boolean;
  slideIndex: number;
  layerCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSlideConfirmDialog({
  open,
  slideIndex,
  layerCount,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
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

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="del-slide-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-slide-title"
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
              width: 420,
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
              id="del-slide-title"
              style={{
                fontFamily: "var(--font-editorial)",
                fontSize: 22,
                fontStyle: "italic",
                letterSpacing: "-0.015em",
                color: "var(--text)",
                marginBottom: 10,
              }}
            >
              {t("editor.filmstrip.deleteConfirm.title", { index: slideIndex })}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text-dim)",
                marginBottom: 14,
              }}
            >
              {t("editor.filmstrip.deleteConfirm.body")}
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
                padding: "8px 10px",
                marginBottom: 20,
              }}
            >
              {layerCount > 0
                ? t("editor.filmstrip.deleteConfirm.layersHint", { count: layerCount })
                : t("editor.filmstrip.deleteConfirm.layersHintNone")}
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
                {t("editor.filmstrip.deleteConfirm.btnCancel")}
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
                {t("editor.filmstrip.deleteConfirm.btnConfirm")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
