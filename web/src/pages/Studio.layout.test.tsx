import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio, { STUDIO_PANELS } from "@/pages/Studio";
import { useComposition } from "@/features/studio/store";
import { useTheme } from "@/stores/theme";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div data-testid="player" data-fps={props.fps} />
  ),
}));

vi.mock("@/features/studio/services/composition", () => ({
  loadComposition: vi.fn(async () => null),
  saveComposition: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

// Stub TerminalPanel — its useEffect constructs `new WebSocket(...)` and
// xterm.js Terminal which neither happy-dom nor jsdom provide. The layout
// test only checks the panel structure (data-panel-id), not terminal
// behaviour (covered by useTerminalSocket.test + TerminalPanel.test).
vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

// Same reasoning for ChatPanel — added 2026-05-17 when RightPane (M.5)
// began hosting both surfaces. ChatPanel pulls in useChatSocket / chat
// store / checkpoints / markdown — all unrelated to the layout test.
vi.mock("@/features/studio/panels/Chat", () => ({
  ChatPanel: ({ workId }: { workId: string }) => (
    <div data-testid="chat-panel-stub">CHAT · {workId}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("/chat")) return { blocks: [] };
    if (url.includes("/assets")) return { assets: [] };
    return {};
  }),
}));

beforeEach(() => {
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
  });
  useTheme.setState({ theme: "dark" });
});

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/studio/w1"]}>
        <Routes>
          <Route path="/studio/:workId" element={<Studio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Studio layout (Phase 9.1: react-resizable-panels)", () => {
  it("locks the Studio shell to the viewport without exposing outer overflow", () => {
    const { container } = mount();
    const shell = container.querySelector(".studio-shell") as HTMLElement;
    const style = getComputedStyle(shell);
    expect(style.overflow).toBe("hidden");
    expect(style.minHeight).toMatch(/^0(px)?$/);
    expect(style.height).toBe(`${window.innerHeight}px`);
  });

  it("renders all expected resizable panels by id", () => {
    const { container } = mount();
    // react-resizable-panels emits data-panel-id on its panel root.
    const ids = Array.from(
      container.querySelectorAll("[data-panel-id]"),
    ).map((el) => el.getAttribute("data-panel-id"));
    expect(ids).toContain("chat");
    expect(ids).toContain("center");
    expect(ids).toContain("aside");
    expect(ids).toContain("preview");
    expect(ids).toContain("timeline");
  });

  it("renders ResizeHandles between panels", () => {
    const { getByTestId } = mount();
    expect(getByTestId("resize-handle-chat-center")).toBeInTheDocument();
    expect(getByTestId("resize-handle-center-aside")).toBeInTheDocument();
    expect(getByTestId("resize-handle-preview-timeline")).toBeInTheDocument();
  });

  it("mounts without throwing (smoke)", () => {
    expect(() => mount()).not.toThrow();
  });
});

// A5 (PRD-0010) — the right (aside) column must be draggable meaningfully wider.
// react-resizable-panels keeps min/max in internal context (never emitted to the
// DOM), so the size constraints live in one exported STUDIO_PANELS config that
// the JSX consumes and this test pins.
describe("Studio panel size constraints (A5)", () => {
  it("widens the aside column's max size to 40% (was 28)", () => {
    expect(STUDIO_PANELS.aside.maxSize).toBe(40);
  });

  it("keeps a center-preview minSize floor so the preview isn't squeezed to nothing", () => {
    // 兜底不破: the center column and its preview keep a non-trivial minimum so
    // dragging the side panels to their maxima can't collapse the preview.
    expect(STUDIO_PANELS.center.minSize).toBeGreaterThanOrEqual(30);
    expect(STUDIO_PANELS.preview.minSize).toBeGreaterThanOrEqual(30);
  });

  it("keeps all three columns' maxima simultaneously satisfiable (sum ≤ 100)", () => {
    // chat.max + center.min + aside.max must fit in 100% so the aside can
    // actually reach 40 without violating the others' minima.
    const sum =
      STUDIO_PANELS.chat.maxSize +
      STUDIO_PANELS.center.minSize +
      STUDIO_PANELS.aside.maxSize;
    expect(sum).toBeLessThanOrEqual(100);
  });
});
