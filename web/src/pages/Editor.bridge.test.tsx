import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor from "./Editor";
import { useEditor } from "@/features/editor/store";

// S2 / US 17 last-mile (v0.1.3): the carousel write endpoints + restore
// broadcast a "carousel-changed" bridge frame, and useBridgeEvents handles it
// by refetching carousel.yaml into the editor store. But the carousel Editor
// PAGE never mounted useBridgeEvents — only Studio did — so an agent slide/
// layer edit (or a restore) never reflected in the Editor preview/filmstrip
// without a manual reload. This test mounts Editor, simulates the WS frame,
// and asserts the carousel service refetch fires + lands in the editor store.

// The carousel service: loadCarousel is called once on mount (initial load,
// returns null → empty carousel) and again on the bridge frame (returns the
// fresh agent-written carousel). Track call args so we can assert the bridge
// refetch happened with the route workId.
const carouselAfterAgentEdit = {
  workId: "w1",
  slides: [
    { id: "s_new", bg: { type: "solid", value: "#000" }, layers: [] },
  ],
  globals: {
    palette: "ink",
    layout: "center",
    headlineFont: "serif",
    effects: { grain: 0 },
  },
  updatedAt: "2026-06-04T00:00:00.000Z",
};
const loadCarousel = vi.fn(async (_workId?: string) => null as unknown);
vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: (workId: string) => loadCarousel(workId),
  saveCarousel: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ blocks: [] })),
}));

vi.mock("@/features/editor/hooks/useExport", () => ({
  useExport: () => ({
    setStage: vi.fn(),
    exportCurrent: vi.fn(),
    exportAll: vi.fn(),
    exporting: false,
    progress: null,
  }),
}));

vi.mock("@/features/editor/canvas/Stage", () => ({
  Stage: () => <div data-testid="stage-stub" />,
}));

vi.mock("@/features/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ workId }: { workId: string }) => (
    <div data-testid="terminal-panel-stub">TERMINAL · {workId}</div>
  ),
}));

vi.mock("@/features/studio/panels/Chat", () => ({
  ChatPanel: ({ workId }: { workId: string }) => (
    <div data-testid="chat-panel-stub">CHAT · {workId}</div>
  ),
}));

// Minimal WebSocket double so useBridgeEvents constructs a socket we can drive.
class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  readyState = MockWS.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
  }
  send() {}
  close() {
    this.onclose?.(new CloseEvent("close"));
  }
  emit(ev: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(ev) }));
  }
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/editor/w1"]}>
        <Routes>
          <Route path="/editor/:workId" element={<Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Editor · bridge subscription (carousel-changed last-mile)", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadCarousel.mockClear();
    useEditor.getState().loadCarousel(null);
  });
  afterEach(() => {
    delete (globalThis as any).WebSocket;
  });

  it("opens a /ws/bridge socket for the route workId", async () => {
    mount();
    await waitFor(() => expect(MockWS.instances.length).toBeGreaterThan(0));
    expect(MockWS.instances[0].url).toContain("/ws/bridge/w1");
  });

  it("a carousel-changed frame refetches carousel.yaml into the editor store (no reload)", async () => {
    mount();
    // wait for the bridge socket to be constructed
    await waitFor(() => expect(MockWS.instances.length).toBeGreaterThan(0));

    // The agent just wrote a new slide; the next loadCarousel resolves to it.
    loadCarousel.mockImplementationOnce(async () => carouselAfterAgentEdit);

    act(() => {
      MockWS.instances[0].emit({
        type: "carousel-changed",
        workId: "w1",
        ts: Date.now(),
        payload: { reason: "slide-add" },
      });
    });

    // refetch must have been asked for THIS work
    await waitFor(() => expect(loadCarousel).toHaveBeenCalledWith("w1"));
    // and the fresh carousel must have landed in the editor store
    await waitFor(() =>
      expect(useEditor.getState().car?.slides[0]?.id).toBe("s_new"),
    );
  });
});
