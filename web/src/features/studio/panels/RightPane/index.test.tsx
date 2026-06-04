/**
 * RightPane container tests (M.5).
 *
 * We stub ChatPanel and TerminalPanel because their real implementations
 * spawn WebSockets / xterm.js / Remotion preview machinery that the unit
 * test environment can't satisfy. The unit of behaviour worth covering
 * here is the container's:
 *
 *   1. tab switching (UI + active state)
 *   2. localStorage persistence (per-work + global fallback)
 *   3. both-surfaces-mounted invariant (no remount on switch)
 *   4. ⌘\ keyboard shortcut + first-use toast
 *   5. graceful fall-back when ChatPanel throws (would be caught by the
 *      ErrorBoundary the parent will eventually wrap each surface in;
 *      we don't assert that here — see SafeChatPanel.test.tsx for the
 *      pattern).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";

// Track **mount** counts (not render counts) — the invariant we care about
// is "switching tabs does not remount the hidden surface." A re-render on
// state change is fine; an unmount/remount blows away pty buffers and chat
// scroll state. useEffect with empty deps fires once per mount lifecycle.
const chatMountCounts = new Map<string, number>();
const terminalMountCounts = new Map<string, number>();

vi.mock("@/features/studio/panels/Chat", () => ({
  ChatPanel: ({ workId }: { workId: string }) => {
    useEffect(() => {
      chatMountCounts.set(workId, (chatMountCounts.get(workId) ?? 0) + 1);
    }, [workId]);
    return <div data-testid={`chat-${workId}`}>chat-{workId}</div>;
  },
}));

vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => {
    useEffect(() => {
      terminalMountCounts.set(
        workId,
        (terminalMountCounts.get(workId) ?? 0) + 1,
      );
    }, [workId]);
    return <div data-testid={`terminal-${workId}`}>terminal-{workId}</div>;
  },
}));

// Stub SessionStrip (I24) — its own behaviour is covered in SessionStrip.test;
// here it would fire a real GET /api/works/:id/sessions that MSW (error mode)
// would flag. The container tests only care about tab switching + mounting.
vi.mock("./SessionStrip", () => ({
  SessionStrip: ({ workId }: { workId: string }) => (
    <div data-testid={`session-strip-${workId}`} />
  ),
}));

// Stub TerminalSessionStrip (I25) — covered in TerminalSessionStrip.test.
// Stubbing it keeps the container's tab-switch / mount assertions free of the
// strip's session tabs (which also carry role="tab" once 2+ sessions exist).
vi.mock("./TerminalSessionStrip", () => ({
  TerminalSessionStrip: ({ workId }: { workId: string }) => (
    <div data-testid={`terminal-session-strip-${workId}`} />
  ),
}));

// Import AFTER mocks so the component picks them up.
import { RightPane } from "./index";
import { useTerminalSessions } from "@/features/terminal/terminalSessions";

function renderRightPane(workId: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RightPane workId={workId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RightPane (M.5)", () => {
  beforeEach(() => {
    localStorage.clear();
    chatMountCounts.clear();
    terminalMountCounts.clear();
    useToastStore.getState().clear();
    // Reset the client-side terminal session list so each work resolves to its
    // single default session (one mounted TerminalPanel) — the mount-count
    // invariant assumes exactly one terminal per work.
    useTerminalSessions.setState({ byWork: {} });
  });

  it("defaults to chat tab for a brand-new work (ADR-005)", () => {
    renderRightPane("w_default");
    const chat = screen.getByTestId("chat-w_default");
    const term = screen.getByTestId("terminal-w_default");
    // Both mounted (M.5 invariant: state preserved across switches)
    expect(chat).toBeInTheDocument();
    expect(term).toBeInTheDocument();
    // chat is visible, terminal is hidden via display:none
    expect(chat.closest('[data-surface="chat"]')).not.toHaveClass(/hidden/);
    expect(term.closest('[data-surface="terminal"]')).toHaveClass(/hidden/);
  });

  it("clicking a tab switches active surface without remounting either", () => {
    renderRightPane("w_switch");
    expect(chatMountCounts.get("w_switch")).toBe(1);
    expect(terminalMountCounts.get("w_switch")).toBe(1);

    const termTab = screen.getByRole("tab", { name: /terminal/i });
    fireEvent.click(termTab);

    // Active state flipped
    expect(termTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // Critical invariant: neither surface remounted (display:none preserves mount)
    expect(chatMountCounts.get("w_switch")).toBe(1);
    expect(terminalMountCounts.get("w_switch")).toBe(1);
  });

  it("persists active surface per-work in localStorage", () => {
    const { unmount } = renderRightPane("w_persist");
    fireEvent.click(screen.getByRole("tab", { name: /terminal/i }));
    expect(localStorage.getItem("autoviral.rightPane.surface.w_persist")).toBe(
      "terminal",
    );
    unmount();
    cleanup();

    // Remount with same workId → terminal is active
    renderRightPane("w_persist");
    expect(screen.getByRole("tab", { name: /terminal/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to the global default when no per-work entry exists", () => {
    // User previously set terminal as their preference in some other work.
    localStorage.setItem("autoviral.rightPane.defaultSurface", "terminal");
    renderRightPane("w_new_work_no_entry");
    expect(screen.getByRole("tab", { name: /terminal/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("⌘\\ / Ctrl+\\ toggles surface + pushes a one-time discoverability toast", () => {
    renderRightPane("w_hotkey");
    expect(useToastStore.getState().entries).toHaveLength(0);

    // First hotkey press — toggles + toast
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("tab", { name: /terminal/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useToastStore.getState().entries).toHaveLength(1);
    expect(useToastStore.getState().entries[0]?.variant).toBe("info");

    // Second press — toggles back, no new toast
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useToastStore.getState().entries).toHaveLength(1);
  });

  it("does NOT trigger toggle for ⌘\\ with Shift / Alt modifiers", () => {
    renderRightPane("w_modifiers");
    fireEvent.keyDown(window, { key: "\\", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "\\", metaKey: true, altKey: true });
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
