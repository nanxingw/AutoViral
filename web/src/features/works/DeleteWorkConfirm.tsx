import { useEffect, useRef } from "react";
import type { WorkSummary } from "@/queries/works";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import styles from "./DeleteWorkConfirm.module.css";

interface DeleteWorkConfirmProps {
  open: boolean;
  work: WorkSummary | null;
  pending: boolean;
  errored: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteWorkConfirm({ open, work, pending, errored, onCancel, onConfirm }: DeleteWorkConfirmProps) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useModalFocus(open, boxRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // Focus the safer (Cancel) button on open for destructive dialog default
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => cancelBtnRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open || !work) return null;

  const isCreating = work.status === "creating";
  const title = t("works.delete.title").replace("{title}", work.title);

  // role="alertdialog" requires explicit user choice (WAI-ARIA APG) — no backdrop dismiss.
  // Esc + Cancel button are the only dismissal paths.
  return (
    <div className={styles.backdrop} data-testid="delete-confirm-backdrop">
      <div
        ref={boxRef}
        className={styles.box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-body"
      >
        <h3 id="delete-confirm-title" className={styles.title}>{title}</h3>
        <div id="delete-confirm-body" className={styles.body}>
          <p>{t("works.delete.body1")}</p>
          <p>{t("works.delete.body2")}</p>
          {isCreating && (
            <p className={styles.warning}>{t("works.delete.creatingWarning")}</p>
          )}
          {errored && !pending && (
            <p className={styles.error} role="alert">{t("works.delete.failed")}</p>
          )}
        </div>
        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
          >
            {t("works.delete.cancel")}
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "…" : t("works.delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
