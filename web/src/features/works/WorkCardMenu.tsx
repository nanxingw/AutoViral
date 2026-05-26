import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import styles from "./WorkCardMenu.module.css";

interface WorkCardMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

export function WorkCardMenu({ onRename, onDelete }: WorkCardMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={t("works.menu.openMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {/* #51 — Rename wires the previously-orphaned useUpdateWork hook
              (PUT /api/works/:id existed + the mutation hook existed, but no UI
              ever called it). Mirrors Delete's icon + visible-label pattern. */}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            title={t("works.menu.rename")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
          >
            <PencilIcon />
            <span className={styles.itemLabel}>{t("works.menu.rename")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.dangerItem}
            title={t("works.menu.delete")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <TrashIcon />
            {/* e2e-report F82 / Round 05 F11: icon + visible text label so
                color-blind / icon-unfamiliar users can identify the action
                without depending on hover tooltip or aria-label. */}
            <span className={styles.dangerItemLabel}>
              {t("works.menu.delete")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
