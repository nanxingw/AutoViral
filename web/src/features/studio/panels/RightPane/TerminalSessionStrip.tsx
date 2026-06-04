/**
 * Terminal session sub-strip (ADR-008 §6 / I25).
 *
 * The terminal analog of I24's chat SessionStrip. Renders under the
 * Chat | Terminal switcher (on the terminal surface) when a work has more than
 * one terminal session (or once the user clicks "new terminal"). Each session
 * is a tab labelled "Terminal N"; a "new terminal" button mints a fresh
 * session WITHOUT killing the existing pty (ADR-008 §6 — a new
 * `(workId, newSessionId)` ws spawns a new shell, the old ones keep running);
 * a per-tab delete disposes that session's pty (sends `{"t":"kill"}`) and drops
 * the tab.
 *
 * Unlike the chat strip, the terminal session list lives entirely CLIENT-SIDE
 * (terminalSessions store / localStorage): the terminal WS layer never writes
 * the `.sessions.jsonl` sidecar, and I24's `/api/works/:id/sessions` endpoints
 * are chat-namespace-bound. Switching the active session just changes which
 * mounted TerminalPanel is visible (the parent display:none's the rest), so the
 * hidden sessions' ptys + xterm canvases survive — jump-back is instant.
 */

import { useState, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { killTerminalSession } from "@/features/terminal/killTerminalSession";
import {
  useTerminalSessions,
  useActiveTerminalSessionId,
  useTerminalSessionIds,
  DEFAULT_TERMINAL_SESSION_ID,
} from "@/features/terminal/terminalSessions";
import styles from "./TerminalSessionStrip.module.css";

/** "s_2" → 2 (the human-facing terminal number). Falls back to the raw id. */
function sessionNumber(id: string): string {
  const m = /^s_(\d+)$/.exec(id);
  return m ? m[1] : id;
}

export interface TerminalSessionStripProps {
  workId: string;
}

export function TerminalSessionStrip({ workId }: TerminalSessionStripProps) {
  const t = useT();
  const ids = useTerminalSessionIds(workId);
  const activeId = useActiveTerminalSessionId(workId);
  const setActive = useTerminalSessions((s) => s.setActive);
  const createSession = useTerminalSessions((s) => s.create);
  const removeSession = useTerminalSessions((s) => s.remove);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Reset any pending delete-confirm when the work changes.
  useEffect(() => {
    setConfirmDelete(null);
  }, [workId]);

  const onNewTerminal = () => {
    // Mint a new session + switch to it. Does NOT touch existing ptys — the new
    // TerminalPanel mounts a fresh socket on the new path (ADR-008 §6).
    createSession(workId);
  };

  const onDelete = (id: string) => {
    // Dispose the pty server-side (explicit kill — ws.close alone would NOT,
    // the pty survives reconnect), then drop the tab from the store so its
    // TerminalPanel unmounts.
    killTerminalSession(workId, id);
    removeSession(workId, id);
    setConfirmDelete(null);
  };

  // Hide the strip for a single-terminal work until the user opts in — the
  // "new terminal" affordance is what reveals multi-session. Show it once
  // there are 2+ terminals OR the active one isn't the default.
  const showStrip = ids.length > 1 || activeId !== DEFAULT_TERMINAL_SESSION_ID;

  return (
    <div
      className={styles.strip}
      role="tablist"
      aria-label={t("studio.rightPane.terminalSessions.stripAria")}
      data-testid="terminal-session-strip"
    >
      {showStrip &&
        ids.map((id) => {
          const num = sessionNumber(id);
          const label = t("studio.rightPane.terminalSessions.sessionLabel", { n: num });
          const isActive = id === activeId;
          // The last remaining terminal is never deletable — a work always
          // keeps one terminal (mirrors the store's remove guard).
          const deletable = ids.length > 1;
          return (
            <div
              key={id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              data-session={id}
              data-active={isActive}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={t("studio.rightPane.terminalSessions.switchAria", { label })}
                className={styles.tabButton}
                onClick={() => setActive(workId, id)}
                title={label}
              >
                <span className={styles.tabIcon} aria-hidden>
                  ⌨
                </span>
                <span className={styles.tabLabel}>{label}</span>
              </button>
              {deletable &&
                (confirmDelete === id ? (
                  <button
                    type="button"
                    className={styles.deleteConfirm}
                    aria-label={t("studio.rightPane.terminalSessions.deleteAria", { label })}
                    onClick={() => onDelete(id)}
                  >
                    {t("studio.rightPane.terminalSessions.deleteConfirm")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label={t("studio.rightPane.terminalSessions.deleteAria", { label })}
                    onClick={() => setConfirmDelete(id)}
                  >
                    ×
                  </button>
                ))}
            </div>
          );
        })}
      <button
        type="button"
        className={styles.newTerminal}
        aria-label={t("studio.rightPane.terminalSessions.newTerminalAria")}
        title={t("studio.rightPane.terminalSessions.newTerminal")}
        onClick={onNewTerminal}
        data-testid="terminal-session-new"
      >
        <span aria-hidden>＋</span>
        {!showStrip && (
          <span className={styles.newTerminalLabel}>
            {t("studio.rightPane.terminalSessions.newTerminal")}
          </span>
        )}
      </button>
    </div>
  );
}
