// #89 — keyboard-shortcut discoverability. The full timeline keymap is
// wired in useShortcuts.ts (Space / J / L / Cmd+S / Cmd+B / B /
// Cmd+Shift+G / Backspace / Shift+Backspace) but nothing in the UI ever
// told the user it exists — no cheatsheet, no "?" panel, no kbd hints.
// This modal is the single source of discoverability; it intentionally
// mirrors the canonical list in useShortcuts.ts's header comment, so the
// two must be kept in sync if a binding changes.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import styles from "./ShortcutsCheatsheet.module.css";

export interface ShortcutsCheatsheetProps {
  onClose: () => void;
}

// macOS uses ⌘; everything else uses Ctrl. useShortcuts.ts binds on
// `e.metaKey || e.ctrlKey`, so both are live — we just label the platform's
// primary modifier.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";

export function ShortcutsCheatsheet({ onClose }: ShortcutsCheatsheetProps) {
  const t = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups: { title: string; rows: { desc: string; keys: string[] }[] }[] =
    [
      {
        title: t("studio.shortcuts.groupPlayback"),
        rows: [
          { desc: t("studio.shortcuts.playPause"), keys: ["Space"] },
          { desc: t("studio.shortcuts.seekBack"), keys: ["J"] },
          { desc: t("studio.shortcuts.seekFwd"), keys: ["L"] },
        ],
      },
      {
        title: t("studio.shortcuts.groupEditing"),
        rows: [
          { desc: t("studio.shortcuts.save"), keys: [MOD, "S"] },
          { desc: t("studio.shortcuts.undo"), keys: [MOD, "Z"] },
          { desc: t("studio.shortcuts.redo"), keys: [MOD, "Shift", "Z"] },
          { desc: t("studio.shortcuts.split"), keys: [MOD, "B"] },
          { desc: t("studio.shortcuts.blade"), keys: ["B"] },
          {
            desc: t("studio.shortcuts.collapseGaps"),
            keys: [MOD, "Shift", "G"],
          },
        ],
      },
      {
        title: t("studio.shortcuts.groupClip"),
        rows: [
          { desc: t("studio.shortcuts.removeClip"), keys: ["Backspace"] },
          {
            desc: t("studio.shortcuts.rippleDelete"),
            keys: ["Shift", "Backspace"],
          },
        ],
      },
    ];

  if (typeof document === "undefined") return null;
  return createPortal(
    // Portal to <body> so `position: fixed` escapes the studio `.glass`
    // shell's backdrop-filter containing block (same trap as
    // ExportCaptionsDialog).
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.box}>
        <div className={styles.header}>
          <h2 id="shortcuts-title" className={styles.title}>
            {t("studio.shortcuts.title")}
          </h2>
          <span className={styles.hint}>{t("studio.shortcuts.openHint")}</span>
        </div>

        {groups.map((g) => (
          <div key={g.title} className={styles.group}>
            <div className={styles.groupTitle}>{g.title}</div>
            {g.rows.map((r) => (
              <div key={r.desc} className={styles.row}>
                <span className={styles.desc}>{r.desc}</span>
                <span className={styles.keys}>
                  {r.keys.map((k, i) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {i > 0 && <span className={styles.plus}>+</span>}
                      <kbd className={styles.kbd}>{k}</kbd>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onClose}
            autoFocus
          >
            {t("studio.shortcuts.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
