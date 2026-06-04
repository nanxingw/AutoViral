/**
 * Terminal session list + active session per work (ADR-008 §6 / I25).
 *
 * The CHAT analog (I24's `web/src/features/chat/activeSession.ts`) only tracks
 * the active sessionId — the session *list* comes from the server over
 * `GET /api/works/:id/sessions`, which the bridge persists in a sidecar.
 *
 * Terminal sessions are DIFFERENT: the terminal WS layer
 * (`src/server/terminal/terminal-ws.ts` + `PtyPool`) is purely in-memory and
 * NEVER writes the `.sessions.jsonl` sidecar — a pty is minted lazily on the
 * first connect to `/ws/terminal/{workId}/{sessionId}` and disposed on an
 * explicit `{"t":"kill"}` or shell exit. And I24's `/api/works/:id/sessions`
 * endpoints are chat-namespace-bound (POST hard-codes `surface:"chat"`, DELETE
 * refuses `s_1` as the default *chat* session, GET would mix surfaces). So the
 * terminal strip cannot reuse that HTTP surface; instead it owns its session
 * list CLIENT-SIDE and persists it in localStorage, terminal-namespaced:
 *
 *   autoviral.terminal.sessions.<workId>  — JSON: { ids: string[], active }
 *
 * This is deliberately a SEPARATE key from the chat store's
 * `autoviral.chat.session.<workId>` so the two surfaces never clobber each
 * other (a work can have chat `s_1` and terminal `s_1` side by side — the
 * server keys the sidecar by `(surface, id)`).
 *
 * Switching the active terminal session just changes which mounted
 * TerminalPanel is visible (display:none on the rest) — the server keeps every
 * session's pty alive across the ws teardown a switch causes, so jumping back
 * re-attaches with scrollback intact (ADR-008 §6).
 */

import { create } from "zustand";

/** Default/first terminal session id — matches the server's
 *  DEFAULT_TERMINAL_SESSION_ID (`src/server/terminal/terminal-ws.ts`) so a
 *  legacy 2-segment connect and the first terminal resolve to the same pty. */
export const DEFAULT_TERMINAL_SESSION_ID = "s_1";

const STORAGE_KEY = (workId: string) => `autoviral.terminal.sessions.${workId}`;

interface PersistedState {
  ids: string[];
  active: string;
}

// Per-work hydration cache keyed by the raw localStorage string. A no-store-
// entry work resolves its state via readPersisted on EVERY selector run; without
// this cache that returns a fresh object each call, which trips React 18's
// useSyncExternalStore "getSnapshot should be cached" guard (and causes spurious
// re-renders). Caching by the raw value means repeated reads of an unchanged
// localStorage entry return the SAME reference; a write busts it (different raw).
const hydrationCache = new Map<string, { raw: string; state: PersistedState }>();

function readPersisted(workId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(workId));
    if (!raw) {
      hydrationCache.delete(workId);
      return null;
    }
    const cached = hydrationCache.get(workId);
    if (cached && cached.raw === raw) return cached.state;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x) => typeof x === "string" && x) : [];
    if (ids.length === 0) return null;
    const active = typeof parsed.active === "string" && ids.includes(parsed.active)
      ? parsed.active
      : ids[0];
    const state: PersistedState = { ids, active };
    hydrationCache.set(workId, { raw, state });
    return state;
  } catch {
    // localStorage can throw in private-mode browsers, or the value can be
    // corrupt — fall back to a fresh default below.
    return null;
  }
}

function writePersisted(workId: string, state: PersistedState): void {
  try {
    const raw = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY(workId), raw);
    // Keep the cache coherent so a subsequent no-entry read returns the SAME
    // object we just stored (stable reference) rather than re-parsing.
    hydrationCache.set(workId, { raw, state });
  } catch {
    // ignore
  }
}

/** A work with no persisted terminal state starts with the single default
 *  session, active. Frozen module singleton so a no-entry work's selector
 *  returns a STABLE reference across store updates — otherwise a fresh array
 *  each call trips React 18's useSyncExternalStore "getSnapshot should be
 *  cached" guard / spurious re-renders. */
const DEFAULT_STATE: PersistedState = Object.freeze({
  ids: Object.freeze([DEFAULT_TERMINAL_SESSION_ID]) as unknown as string[],
  active: DEFAULT_TERMINAL_SESSION_ID,
});

function defaultState(): PersistedState {
  return DEFAULT_STATE;
}

/** Mint the next terminal session id: `s_<n>` where n is one past the highest
 *  numeric id currently in the list (so a deleted id is never reused within
 *  the live list — monotonic like the server's nextSessionId). */
function nextSessionId(ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const m = /^s_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s_${max + 1}`;
}

interface TerminalSessionsStore {
  /** workId → { ids, active }. Hydrated lazily from localStorage on first read. */
  byWork: Record<string, PersistedState>;
  /** Resolve (and hydrate) the session state for a work. Pure read — safe
   *  during render; never mutates the store. */
  get: (workId: string) => PersistedState;
  /** Switch the active terminal session for a work + persist. */
  setActive: (workId: string, sessionId: string) => void;
  /** Append a brand-new terminal session and switch to it. Returns the new id.
   *  Does NOT touch existing sessions' ptys — a new (workId, newSessionId) ws
   *  mints a fresh shell while the old ones keep running (ADR-008 §6). */
  create: (workId: string) => string;
  /** Remove a terminal session from the list (after its pty is killed). Falls
   *  back to the default/first remaining session if the removed one was active.
   *  Refuses to remove the last session — a work always keeps one terminal. */
  remove: (workId: string, sessionId: string) => void;
}

function hydrate(state: TerminalSessionsStore, workId: string): PersistedState {
  return state.byWork[workId] ?? readPersisted(workId) ?? defaultState();
}

export const useTerminalSessions = create<TerminalSessionsStore>((set, getState) => ({
  byWork: {},
  get: (workId) => hydrate(getState(), workId),
  setActive: (workId, sessionId) => {
    set((s) => {
      const cur = hydrate(s, workId);
      // Unknown id (not in this work's list) or already active → no-op (don't
      // churn the store reference).
      if (!cur.ids.includes(sessionId) || cur.active === sessionId) return s;
      const next: PersistedState = { ...cur, active: sessionId };
      writePersisted(workId, next);
      return { byWork: { ...s.byWork, [workId]: next } };
    });
  },
  create: (workId) => {
    const cur = hydrate(getState(), workId);
    const id = nextSessionId(cur.ids);
    const next: PersistedState = { ids: [...cur.ids, id], active: id };
    writePersisted(workId, next);
    set((s) => ({ byWork: { ...s.byWork, [workId]: next } }));
    return id;
  },
  remove: (workId, sessionId) => {
    set((s) => {
      const cur = hydrate(s, workId);
      const remaining = cur.ids.filter((x) => x !== sessionId);
      if (remaining.length === 0) {
        // Never drop the last terminal — a work always has at least one.
        return s;
      }
      const active = cur.active === sessionId ? remaining[0] : cur.active;
      const next: PersistedState = { ids: remaining, active };
      writePersisted(workId, next);
      return { byWork: { ...s.byWork, [workId]: next } };
    });
  },
}));

/**
 * Hook: the active terminal sessionId for a work, reactive to switches /
 * create / remove. Hydrates from localStorage (or the default) when the store
 * has no entry yet — a pure read, no setState-during-render.
 */
export function useActiveTerminalSessionId(workId: string | null): string {
  return useTerminalSessions((s) =>
    workId ? hydrate(s, workId).active : DEFAULT_TERMINAL_SESSION_ID,
  );
}

/** Hook: the ordered terminal session id list for a work, reactive. Returns a
 *  STABLE reference when the work has no entry yet (frozen singleton) so the
 *  selector never trips the useSyncExternalStore snapshot guard. */
export function useTerminalSessionIds(workId: string | null): string[] {
  return useTerminalSessions((s) =>
    workId ? hydrate(s, workId).ids : DEFAULT_STATE.ids,
  );
}
