/**
 * SessionStrip tests (I24 · multi-conversation tabs).
 *
 * Covers the user-visible behaviour of the chat session strip:
 *   1. renders a tab per session from GET /api/works/:id/sessions
 *   2. "new chat" POSTs, appends the new session, and switches active to it
 *   3. clicking a session tab switches the active session (persisted)
 *
 * apiFetch is mocked so no real network/bridge is needed; the activeSession
 * store is the source of truth the assertions read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ChatSessionRecord } from "@/features/chat/types";

const nowIso = new Date().toISOString();
function rec(id: string, extra: Partial<ChatSessionRecord> = {}): ChatSessionRecord {
  return {
    id,
    surface: "chat",
    createdAt: nowIso,
    lastActive: nowIso,
    preview: "",
    archived: false,
    ...extra,
  };
}

// Mutable fixtures the mocked apiFetch reads/writes so create() round-trips.
let sessionsFixture: ChatSessionRecord[] = [];
let nextCreated: ChatSessionRecord = rec("s_2");

const apiFetchMock = vi.fn(async (path: string, opts?: { method?: string }) => {
  if (path.endsWith("/sessions") && (opts?.method ?? "GET") === "GET") {
    return { sessions: sessionsFixture };
  }
  if (path.endsWith("/sessions") && opts?.method === "POST") {
    sessionsFixture = [...sessionsFixture, nextCreated];
    return { session: nextCreated };
  }
  if (opts?.method === "DELETE") {
    const id = path.split("/").pop()!;
    sessionsFixture = sessionsFixture.filter((s) => s.id !== id);
    return { deleted: true };
  }
  return {};
});

vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...(a as [string, { method?: string }])) }));

// Import AFTER the mock so the component picks it up.
import { SessionStrip } from "./SessionStrip";
import { useActiveSession, DEFAULT_SESSION_ID } from "@/features/chat/activeSession";

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockClear();
  sessionsFixture = [];
  nextCreated = rec("s_2");
  // Reset the active-session store between tests.
  useActiveSession.setState({ byWork: {} });
});

describe("SessionStrip (I24)", () => {
  it("renders a tab per session once there are 2+", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w1" />);
    // Both session tabs render (label "Session 1" / "Session 2" or ZH "会话 N").
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Session 1|会话 1/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /Session 2|会话 2/ })).toBeInTheDocument();
  });

  it("'new chat' creates a session and switches active to it", async () => {
    sessionsFixture = [rec("s_1")]; // single session → strip hidden, just the +
    nextCreated = rec("s_2");
    render(<SessionStrip workId="w_new" />);

    // Active starts at the default session.
    expect(useActiveSession.getState().get("w_new")).toBe(DEFAULT_SESSION_ID);

    fireEvent.click(screen.getByTestId("session-new-chat"));

    // POST fired, store switched to the new session.
    await waitFor(() => {
      expect(useActiveSession.getState().byWork["w_new"]).toBe("s_2");
    });
    expect(
      apiFetchMock.mock.calls.some(
        ([p, o]) => p === "/api/works/w_new/sessions" && o?.method === "POST",
      ),
    ).toBe(true);
    // The new tab is now visible + selected.
    expect(screen.getByRole("tab", { name: /Session 2|会话 2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("clicking a session tab switches + persists the active session", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w_switch" />);
    const tab2 = await screen.findByRole("tab", { name: /Session 2|会话 2/ });

    fireEvent.click(tab2);

    expect(useActiveSession.getState().byWork["w_switch"]).toBe("s_2");
    // Persisted per work (ADR-005 key pattern).
    expect(localStorage.getItem("autoviral.chat.session.w_switch")).toBe("s_2");

    // Switching back to s_1 works too (jump-back).
    fireEvent.click(screen.getByRole("tab", { name: /Session 1|会话 1/ }));
    expect(useActiveSession.getState().byWork["w_switch"]).toBe("s_1");
  });

  it("shows a delete affordance for EVERY session (incl. s_1) when 2+ exist", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w_del" />);
    await screen.findByRole("tab", { name: /Session 1|会话 1/ });
    // Both sessions now carry a delete (×) affordance — s_1 is no longer locked.
    const deleteButtons = screen.queryAllByRole("button", { name: /Delete|删除/ });
    expect(deleteButtons.length).toBe(2);
    cleanup();
  });

  it("hides the delete affordance when only one session remains", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w_one" />);
    await screen.findByRole("tab", { name: /Session 1|会话 1/ });
    // Two sessions → two ×. After deleting one, only one remains → zero ×.
    const s2Delete = screen.getByRole("button", { name: /Delete Session 2|删除 会话 2/ });
    fireEvent.click(s2Delete); // arm confirm
    fireEvent.click(screen.getByRole("button", { name: /Delete Session 2|删除 会话 2/ })); // confirm

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Session 2|会话 2/ })).not.toBeInTheDocument();
    });
    // Single session left → no delete affordance is offered.
    expect(screen.queryAllByRole("button", { name: /Delete|删除/ }).length).toBe(0);
    cleanup();
  });

  it("deleting the active s_1 (two-click) DELETEs it and falls back to the remaining session", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w_dels1" />);
    await screen.findByRole("tab", { name: /Session 1|会话 1/ });
    // Active starts at s_1 (the default) for this work.
    expect(useActiveSession.getState().get("w_dels1")).toBe(DEFAULT_SESSION_ID);

    // Two-click confirm on s_1's × — first click arms, second click commits.
    const s1Delete = screen.getByRole("button", { name: /Delete Session 1|删除 会话 1/ });
    fireEvent.click(s1Delete);
    fireEvent.click(screen.getByRole("button", { name: /Delete Session 1|删除 会话 1/ }));

    // DELETE /sessions/s_1 fired …
    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([p, o]) => p === "/api/works/w_dels1/sessions/s_1" && o?.method === "DELETE",
        ),
      ).toBe(true);
    });
    // … and the active session fell back to the FIRST REMAINING session (s_2),
    // not hardcoded to DEFAULT_SESSION_ID.
    await waitFor(() => {
      expect(useActiveSession.getState().byWork["w_dels1"]).toBe("s_2");
    });
    expect(screen.queryByRole("tab", { name: /Session 1|会话 1/ })).not.toBeInTheDocument();
    cleanup();
  });
});
