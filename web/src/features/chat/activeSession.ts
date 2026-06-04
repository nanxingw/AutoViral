/**
 * Active chat session per work (ADR-008 §5 / I24).
 *
 * A work used to host exactly one chat. ADR-008 moves identity to
 * `(workId, sessionId)` so a work now owns a *list* of sessions and the user
 * can jump between them. This store tracks which session is active for each
 * work and persists that choice in `localStorage`, mirroring ADR-005's
 * per-work key pattern (`useActiveSurface.ts`):
 *
 *   autoviral.chat.session.<workId>  — per-work active sessionId
 *
 * `useChatSocket` reads the active sessionId from here (so it can open the
 * 3-segment `/ws/browser/{workId}/{sessionId}` route) and the RightPane
 * session strip writes to it on switch / new-chat. Keeping it in a shared
 * zustand store — rather than threading a prop through ChatPanel — means a
 * switch re-runs the socket effect reactively without touching ChatPanel.
 *
 * The default session id is `s_1` (matches the backend's
 * `DEFAULT_CHAT_SESSION_ID` / legacy-migration target), so a brand-new or
 * legacy work resolves to the same session the bridge synthesises.
 */

import { create } from "zustand";

export const DEFAULT_SESSION_ID = "s_1";

const STORAGE_KEY = (workId: string) => `autoviral.chat.session.${workId}`;

function readPersisted(workId: string): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY(workId));
    return v && v.trim() ? v : null;
  } catch {
    // localStorage can throw in private-mode browsers; fall through.
    return null;
  }
}

function writePersisted(workId: string, sessionId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY(workId), sessionId);
  } catch {
    // ignore
  }
}

interface ActiveSessionStore {
  /** workId → active sessionId. */
  byWork: Record<string, string>;
  /** Resolve the active session for a work, hydrating from localStorage when
   *  the store has no entry yet (falling back to the default session). Pure
   *  read — never mutates, safe to call during render. */
  get: (workId: string) => string;
  /** Switch the active session for a work + persist it. */
  set: (workId: string, sessionId: string) => void;
}

export const useActiveSession = create<ActiveSessionStore>((set, getState) => ({
  byWork: {},
  get: (workId) => getState().byWork[workId] ?? readPersisted(workId) ?? DEFAULT_SESSION_ID,
  set: (workId, sessionId) => {
    writePersisted(workId, sessionId);
    set((s) => ({ byWork: { ...s.byWork, [workId]: sessionId } }));
  },
}));

/**
 * Hook: the active sessionId for a work, reactive to switches.
 *
 * Subscribes to `byWork[workId]` only. When the store has no entry yet it
 * falls back to the persisted value (localStorage) or the default session —
 * a pure read, no setState-during-render. The first explicit `set()` (a tab
 * switch / new chat) seeds the store entry and re-renders subscribers.
 */
export function useActiveSessionId(workId: string | null): string {
  return useActiveSession((s) =>
    workId ? (s.byWork[workId] ?? readPersisted(workId) ?? DEFAULT_SESSION_ID) : DEFAULT_SESSION_ID,
  );
}
