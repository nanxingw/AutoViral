/**
 * Chat session sub-strip (ADR-008 §5 / I24).
 *
 * Renders under the Chat | Terminal switcher when a work has more than one
 * chat session (or once the user clicks "new chat"). Each session is a tab
 * labelled "Session N · 3h ago" with a turn count on the active one; a
 * "new chat" button mints a fresh session. Clicking a tab switches the active
 * session — `useChatSocket` reads that from the activeSession store, closes
 * the old `/ws/browser/{workId}/{sid}` socket and opens the new one, and the
 * backend re-seeds the switched-to session's history over `message_history`.
 *
 * The active session is persisted per work (localStorage) by the activeSession
 * store, so a reload restores the same conversation. Focus (playhead /
 * selection) is deliberately NOT keyed by session — ADR-008 §3 keeps it
 * work-scoped and shared across sessions.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";
import type { ChatSessionRecord } from "@/features/chat/types";
import {
  useActiveSession,
  useActiveSessionId,
  DEFAULT_SESSION_ID,
} from "@/features/chat/activeSession";
import { useChatStore } from "@/features/chat/store";
import styles from "./SessionStrip.module.css";

/** "s_2" → 2 (the human-facing session number). Falls back to the raw id. */
function sessionNumber(id: string): string {
  const m = /^s_(\d+)$/.exec(id);
  return m ? m[1] : id;
}

/** Compact localized "Xh ago" from an ISO timestamp. */
function useRelativeTime(): (iso: string) => string {
  const t = useT();
  return useCallback(
    (iso: string) => {
      const then = Date.parse(iso);
      if (Number.isNaN(then)) return "";
      const diffMs = Date.now() - then;
      const mins = Math.floor(diffMs / 60_000);
      if (mins < 1) return t("studio.rightPane.sessions.justNow");
      if (mins < 60) return t("studio.rightPane.sessions.minutesAgo", { n: mins });
      const hours = Math.floor(mins / 60);
      if (hours < 24) return t("studio.rightPane.sessions.hoursAgo", { n: hours });
      const days = Math.floor(hours / 24);
      return t("studio.rightPane.sessions.daysAgo", { n: days });
    },
    [t],
  );
}

export interface SessionStripProps {
  workId: string;
}

export function SessionStrip({ workId }: SessionStripProps) {
  const t = useT();
  const relative = useRelativeTime();
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const activeId = useActiveSessionId(workId);
  const setActive = useActiveSession((s) => s.set);
  // Live block count — only meaningful for the ACTIVE session (that's whose
  // blocks the chat store holds). Labelled "N blocks" (not "N turns"): the
  // store holds EVERY StreamBlock (user / assistant / tool_use / tool_result /
  // thinking), so a 3-turn convo with tool use is ~40 blocks — calling that
  // "turns" overstated the real exchange count.
  const activeBlockCount = useChatStore((s) => s.blocks.length);

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiFetch<{ sessions: ChatSessionRecord[] }>(
        `/api/works/${workId}/sessions`,
      );
      setSessions(data.sessions ?? []);
    } catch {
      // No bridge / 404 — leave whatever we have; the default session still works.
    }
  }, [workId]);

  useEffect(() => {
    setConfirmDelete(null);
    void loadSessions();
  }, [loadSessions]);

  const createSession = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const data = await apiFetch<{ session: ChatSessionRecord }>(
        `/api/works/${workId}/sessions`,
        { method: "POST" },
      );
      if (data.session) {
        // Append (avoid a refetch race) and switch to the new session.
        setSessions((prev) =>
          prev.some((s) => s.id === data.session.id) ? prev : [...prev, data.session],
        );
        setActive(workId, data.session.id);
      }
    } catch {
      // ignore — strip stays as-is
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (id === DEFAULT_SESSION_ID) return; // default session is never deletable
    try {
      await apiFetch(`/api/works/${workId}/sessions/${id}`, { method: "DELETE" });
    } catch {
      // ignore failure — refetch below reconciles
    }
    setConfirmDelete(null);
    // If we deleted the active session, fall back to the default one.
    if (activeId === id) setActive(workId, DEFAULT_SESSION_ID);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  // Hide the strip entirely for a single-session work until the user opts in —
  // the "new chat" affordance is what reveals multi-session. We still show it
  // once there are 2+ sessions OR the active session isn't the default.
  const showStrip = sessions.length > 1 || activeId !== DEFAULT_SESSION_ID;

  return (
    <div
      className={styles.strip}
      role="tablist"
      aria-label={t("studio.rightPane.sessions.stripAria")}
      data-testid="session-strip"
    >
      {showStrip &&
        sessions.map((s) => {
          const num = sessionNumber(s.id);
          const label = t("studio.rightPane.sessions.sessionLabel", { n: num });
          const isActive = s.id === activeId;
          const rel = relative(s.lastActive);
          const blocksLabel =
            isActive && activeBlockCount > 0
              ? t("studio.rightPane.sessions.blocks", { n: activeBlockCount })
              : "";
          const meta = [rel, blocksLabel].filter(Boolean).join(" · ");
          return (
            <div
              key={s.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              data-session={s.id}
              data-active={isActive}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={t("studio.rightPane.sessions.switchAria", { label })}
                className={styles.tabButton}
                onClick={() => setActive(workId, s.id)}
                title={s.preview || label}
              >
                <span className={styles.tabLabel}>{label}</span>
                {meta && <span className={styles.tabMeta}>{meta}</span>}
              </button>
              {s.id !== DEFAULT_SESSION_ID &&
                (confirmDelete === s.id ? (
                  <button
                    type="button"
                    className={styles.deleteConfirm}
                    aria-label={t("studio.rightPane.sessions.deleteAria", { label })}
                    onClick={() => void deleteSession(s.id)}
                  >
                    {t("studio.rightPane.sessions.deleteConfirm")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label={t("studio.rightPane.sessions.deleteAria", { label })}
                    onClick={() => setConfirmDelete(s.id)}
                  >
                    ×
                  </button>
                ))}
            </div>
          );
        })}
      <button
        type="button"
        className={styles.newChat}
        aria-label={t("studio.rightPane.sessions.newChatAria")}
        title={t("studio.rightPane.sessions.newChat")}
        onClick={() => void createSession()}
        disabled={creating}
        data-testid="session-new-chat"
      >
        <span aria-hidden>＋</span>
        {!showStrip && <span className={styles.newChatLabel}>{t("studio.rightPane.sessions.newChat")}</span>}
      </button>
    </div>
  );
}
