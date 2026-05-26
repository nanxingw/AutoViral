import { useEffect, useRef, useState } from "react";
import type { WorkSummary } from "@/queries/works";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import styles from "./RenameWorkDialog.module.css";

interface RenameWorkDialogProps {
  open: boolean;
  work: WorkSummary | null;
  pending: boolean;
  errored: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}

/**
 * #51 — Rename dialog wiring the previously-orphaned useUpdateWork hook. Mirrors
 * DeleteWorkConfirm's modal/focus/Escape conventions, but is non-destructive:
 * focus lands on the text input (not a "safe" cancel button) and submitting
 * the form (Enter or Save) commits. Empty titles are allowed — consistent with
 * NewWorkCard's "or leave blank" affordance; the grid falls back to "Untitled".
 */
export function RenameWorkDialog({ open, work, pending, errored, onCancel, onConfirm }: RenameWorkDialogProps) {
  const t = useT();
  const boxRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState("");

  useModalFocus(open, boxRef);

  // Seed the field with the current title each time the dialog opens, and
  // capture the opener so focus restores on close (WAI-ARIA dialog pattern).
  useEffect(() => {
    if (open) {
      setValue(work?.title ?? "");
      const opener = document.activeElement;
      if (opener instanceof HTMLElement) openerRef.current = opener;
      const id = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(id);
    } else if (openerRef.current) {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [open, work]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !work) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    onConfirm(value.trim());
  };

  return (
    <div className={styles.backdrop} data-testid="rename-dialog-backdrop">
      <form
        ref={boxRef}
        className={styles.box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-dialog-title"
        onSubmit={submit}
      >
        <h3 id="rename-dialog-title" className={styles.title}>{t("works.rename.title")}</h3>
        <label className={styles.label} htmlFor="rename-dialog-input">
          {t("works.rename.label")}
        </label>
        <input
          id="rename-dialog-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          placeholder={t("works.rename.placeholder")}
          onChange={(e) => setValue(e.target.value)}
        />
        {errored && !pending && (
          <p className={styles.error} role="alert">{t("works.rename.failed")}</p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={onCancel}>
            {t("works.rename.cancel")}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={pending}>
            {pending ? "…" : t("works.rename.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
