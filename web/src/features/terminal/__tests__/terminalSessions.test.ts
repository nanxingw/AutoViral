/**
 * terminalSessions store tests (ADR-008 §6 / I25).
 *
 * The terminal session list is client-side (no server endpoint — the terminal
 * WS layer never writes the sidecar). This store owns the list + active id,
 * terminal-namespaced in localStorage so it never clobbers the chat store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useTerminalSessions,
  DEFAULT_TERMINAL_SESSION_ID,
} from "../terminalSessions";

beforeEach(() => {
  localStorage.clear();
  useTerminalSessions.setState({ byWork: {} });
});

describe("terminalSessions store (I25)", () => {
  it("a fresh work resolves to the single default session, active", () => {
    const st = useTerminalSessions.getState().get("w1");
    expect(st.ids).toEqual([DEFAULT_TERMINAL_SESSION_ID]);
    expect(st.active).toBe(DEFAULT_TERMINAL_SESSION_ID);
  });

  it("create() appends the next id and switches active to it (old session kept)", () => {
    const id = useTerminalSessions.getState().create("w1");
    expect(id).toBe("s_2");
    const st = useTerminalSessions.getState().get("w1");
    expect(st.ids).toEqual(["s_1", "s_2"]);
    expect(st.active).toBe("s_2"); // switched to the new one
    // The original session is still in the list — "new terminal" never drops it.
    expect(st.ids).toContain("s_1");
  });

  it("create() mints monotonically increasing ids", () => {
    useTerminalSessions.getState().create("w1"); // s_2
    const id3 = useTerminalSessions.getState().create("w1"); // s_3
    expect(id3).toBe("s_3");
    expect(useTerminalSessions.getState().get("w1").ids).toEqual(["s_1", "s_2", "s_3"]);
  });

  it("setActive() switches + persists the active session", () => {
    useTerminalSessions.getState().create("w1"); // s_2 active
    useTerminalSessions.getState().setActive("w1", "s_1");
    expect(useTerminalSessions.getState().get("w1").active).toBe("s_1");
    // Persisted so a reload restores it.
    const raw = localStorage.getItem("autoviral.terminal.sessions.w1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).active).toBe("s_1");
  });

  it("remove() drops the session and falls back to the first remaining when the active was removed", () => {
    useTerminalSessions.getState().create("w1"); // s_2, active
    useTerminalSessions.getState().remove("w1", "s_2");
    const st = useTerminalSessions.getState().get("w1");
    expect(st.ids).toEqual(["s_1"]);
    expect(st.active).toBe("s_1");
  });

  it("remove() refuses to drop the last session (a work always keeps one terminal)", () => {
    useTerminalSessions.getState().remove("w1", "s_1");
    const st = useTerminalSessions.getState().get("w1");
    expect(st.ids).toEqual(["s_1"]);
  });

  it("hydrates the list from localStorage on first read", () => {
    localStorage.setItem(
      "autoviral.terminal.sessions.w9",
      JSON.stringify({ ids: ["s_1", "s_2", "s_4"], active: "s_4" }),
    );
    const st = useTerminalSessions.getState().get("w9");
    expect(st.ids).toEqual(["s_1", "s_2", "s_4"]);
    expect(st.active).toBe("s_4");
    // A new session mints one past the highest existing id (s_5, not s_3).
    const id = useTerminalSessions.getState().create("w9");
    expect(id).toBe("s_5");
  });

  it("uses a terminal-namespaced key distinct from the chat store", () => {
    // Any mutation persists under the terminal namespace.
    useTerminalSessions.getState().create("w1");
    expect(localStorage.getItem("autoviral.terminal.sessions.w1")).toBeTruthy();
    // Never writes the chat store's key.
    expect(localStorage.getItem("autoviral.chat.session.w1")).toBeNull();
  });
});
