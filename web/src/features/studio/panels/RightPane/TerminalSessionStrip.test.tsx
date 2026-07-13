/**
 * TerminalSessionStrip tests (ADR-008 §6 / I25).
 *
 * Covers the user-visible behaviour of the terminal session strip:
 *   1. renders a tab per terminal session once there are 2+
 *   2. "new terminal" appends + switches WITHOUT killing the existing pty
 *      (no kill frame to the old session)
 *   3. switching tabs flips the active session (persisted, terminal-namespaced)
 *   4. delete disposes the session's pty via an explicit {"t":"kill"} frame
 *   5. the last remaining terminal is not deletable
 *
 * killTerminalSession is mocked so no real WS is opened; the terminalSessions
 * store is the source of truth the assertions read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Spy on the kill helper so we can assert delete (and only delete) disposes a pty.
const killMock = vi.fn();
vi.mock("@/features/terminal/killTerminalSession", () => ({
  killTerminalSession: (...a: unknown[]) => killMock(...a),
}));

import { TerminalSessionStrip } from "./TerminalSessionStrip";
import {
  useTerminalSessions,
  DEFAULT_TERMINAL_SESSION_ID,
} from "@/features/terminal/terminalSessions";

beforeEach(() => {
  localStorage.clear();
  killMock.mockClear();
  useTerminalSessions.setState({ byWork: {} });
});

describe("TerminalSessionStrip (I25)", () => {
  it("renders a tab per terminal session once there are 2+", () => {
    useTerminalSessions.setState({ byWork: { w1: { ids: ["s_1", "s_2"], active: "s_1" } } });
    render(<TerminalSessionStrip workId="w1" />);
    expect(screen.getByRole("tab", { name: /Terminal 1|终端 1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Terminal 2|终端 2/ })).toBeInTheDocument();
  });

  it("'new terminal' appends a session and switches active to it", () => {
    render(<TerminalSessionStrip workId="w_new" />);
    // Single session → strip hidden, just the labelled "+" button.
    expect(useTerminalSessions.getState().get("w_new").active).toBe(DEFAULT_TERMINAL_SESSION_ID);

    fireEvent.click(screen.getByTestId("terminal-session-new"));

    const st = useTerminalSessions.getState().get("w_new");
    expect(st.ids).toEqual(["s_1", "s_2"]);
    expect(st.active).toBe("s_2");
    // The new tab is now visible + selected.
    expect(screen.getByRole("tab", { name: /Terminal 2|终端 2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("'new terminal' does NOT kill the existing pty", () => {
    useTerminalSessions.setState({ byWork: { w2: { ids: ["s_1"], active: "s_1" } } });
    render(<TerminalSessionStrip workId="w2" />);
    fireEvent.click(screen.getByTestId("terminal-session-new"));
    // Creating a new terminal must never dispose the old one (ADR-008 §6).
    expect(killMock).not.toHaveBeenCalled();
  });

  it("clicking a tab switches + persists the active session", () => {
    useTerminalSessions.setState({ byWork: { w3: { ids: ["s_1", "s_2"], active: "s_1" } } });
    render(<TerminalSessionStrip workId="w3" />);

    fireEvent.click(screen.getByRole("tab", { name: /Terminal 2|终端 2/ }));
    expect(useTerminalSessions.getState().get("w3").active).toBe("s_2");
    expect(JSON.parse(localStorage.getItem("autoviral.terminal.sessions.w3")!).active).toBe("s_2");

    // Jump back to Terminal 1.
    fireEvent.click(screen.getByRole("tab", { name: /Terminal 1|终端 1/ }));
    expect(useTerminalSessions.getState().get("w3").active).toBe("s_1");
  });

  it("delete disposes the pty (kill frame) and drops the tab", () => {
    useTerminalSessions.setState({ byWork: { w4: { ids: ["s_1", "s_2"], active: "s_2" } } });
    render(<TerminalSessionStrip workId="w4" />);

    // Two-step confirm: first click reveals the confirm, second click deletes.
    const delBtn = screen.getByRole("button", { name: /Close Terminal 2|关闭 终端 2/ });
    fireEvent.click(delBtn);
    fireEvent.click(screen.getByRole("button", { name: /Close Terminal 2|关闭 终端 2/ }));

    // The pty was disposed via the kill helper for (workId, sessionId).
    expect(killMock).toHaveBeenCalledWith("w4", "s_2");
    // The tab is gone; active falls back to s_1.
    const st = useTerminalSessions.getState().get("w4");
    expect(st.ids).toEqual(["s_1"]);
    expect(st.active).toBe("s_1");
  });

  it("uses a shared icon button with a 24px transparent hit target and keeps two-step delete", () => {
    useTerminalSessions.setState({ byWork: { w_icon: { ids: ["s_1", "s_2"], active: "s_1" } } });
    render(<TerminalSessionStrip workId="w_icon" />);
    const deleteButton = screen.getByRole("button", {
      name: /Close Terminal 2|\u5173\u95ed \u7ec8\u7aef 2/,
    });

    expect(deleteButton).toHaveAttribute("data-icon-button");
    expect(deleteButton.querySelector("svg")).not.toBeNull();
    expect(deleteButton).toHaveStyle({ width: "18px", height: "18px" });
    expect(
      within(deleteButton).getByTestId("terminal-session-delete-hit-target"),
    ).toHaveStyle({ width: "24px", height: "24px" });

    fireEvent.click(deleteButton);
    expect(
      screen.getByRole("button", { name: /Close Terminal 2|\u5173\u95ed \u7ec8\u7aef 2/ }),
    ).toHaveTextContent(/Close\?|\u5173\u95ed\uff1f/i);
  });

  it("does not render a delete affordance for the last remaining terminal", () => {
    useTerminalSessions.setState({ byWork: { w5: { ids: ["s_2"], active: "s_2" } } });
    render(<TerminalSessionStrip workId="w5" />);
    // Strip is shown (active != default), but the single session has no delete.
    const deleteButtons = screen.queryAllByRole("button", { name: /Close|关闭/ });
    expect(deleteButtons.length).toBe(0);
  });
});
