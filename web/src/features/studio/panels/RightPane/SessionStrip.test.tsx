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

  it("does not render a delete affordance for the default session", async () => {
    sessionsFixture = [rec("s_1"), rec("s_2")];
    render(<SessionStrip workId="w_del" />);
    await screen.findByRole("tab", { name: /Session 1|会话 1/ });
    // s_2 has a delete button; s_1 does not.
    expect(screen.getByRole("button", { name: /Session 2|会话 2/ })).toBeTruthy();
    const deleteButtons = screen.queryAllByRole("button", { name: /Delete|删除/ });
    // Exactly one delete affordance — for s_2, never s_1.
    expect(deleteButtons.length).toBe(1);
    cleanup();
  });
});
