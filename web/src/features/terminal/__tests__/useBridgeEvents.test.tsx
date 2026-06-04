import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useBridgeEvents } from "../useBridgeEvents";

// The hook dynamically imports the composition service and calls
// loadComposition(workId) on both composition-changed and asset-added. Mock it
// so we can assert the refetch fired without touching the network.
const loadComposition = vi.fn(async (_workId?: string) => null);
vi.mock("@/features/studio/services/composition", () => ({
  loadComposition: (workId: string) => loadComposition(workId),
}));

// S2 (US 17) — carousel-changed refetches the carousel into the editor store.
// Mock the carousel service + the editor store so we can assert the refetch
// pushed the new carousel into state without touching the network.
const loadCarousel = vi.fn(async (_workId?: string) => ({ workId: "w_test", slides: [] }));
vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: (workId: string) => loadCarousel(workId),
}));
const loadCarouselIntoStore = vi.fn();
vi.mock("@/features/editor/store", () => ({
  useEditor: {
    getState: () => ({ loadCarousel: loadCarouselIntoStore }),
  },
}));

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
  /** Test helper — push a UiEvent frame as if the server sent it. */
  emit(ev: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(ev) }));
  }
}

function renderBridge(workId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useBridgeEvents(workId), { wrapper });
  return { invalidateSpy };
}

describe("useBridgeEvents · asset-added (I17)", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadComposition.mockClear();
  });
  afterEach(() => {
    delete (globalThis as any).WebSocket;
    vi.restoreAllMocks();
  });

  it("composition-changed refetches the composition from disk", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "composition-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: {},
      });
    });
    await waitFor(() => expect(loadComposition).toHaveBeenCalledWith("w_test"));
  });

  it("asset-added triggers the SAME composition refetch as composition-changed", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "asset-added",
        workId: "w_test",
        ts: Date.now(),
        payload: { kind: "image", uri: "assets/gen/x.png", origin: "generate" },
      });
    });
    await waitFor(() => expect(loadComposition).toHaveBeenCalledWith("w_test"));
  });

  it("asset-added ALSO invalidates the [\"assets\", workId] library query", async () => {
    const { invalidateSpy } = renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "asset-added",
        workId: "w_test",
        ts: Date.now(),
        payload: { kind: "video", uri: "assets/seedance/c.mp4", origin: "generate" },
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["assets", "w_test"] });
  });

  it("composition-changed does NOT invalidate the assets query (scoped to asset-added)", async () => {
    const { invalidateSpy } = renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "composition-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: {},
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["assets", "w_test"],
    });
  });
});

describe("useBridgeEvents · carousel-changed (S2 / US 17)", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadCarousel.mockClear();
    loadCarouselIntoStore.mockClear();
  });
  afterEach(() => {
    delete (globalThis as any).WebSocket;
    vi.restoreAllMocks();
  });

  it("carousel-changed refetches the carousel and loads it into the editor store", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "carousel-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: { reason: "slide-add" },
      });
    });
    await waitFor(() => expect(loadCarousel).toHaveBeenCalledWith("w_test"));
    await waitFor(() =>
      expect(loadCarouselIntoStore).toHaveBeenCalledWith({
        workId: "w_test",
        slides: [],
      }),
    );
  });

  it("carousel-changed does NOT trigger the composition refetch", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "carousel-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: {},
      });
    });
    await waitFor(() => expect(loadCarousel).toHaveBeenCalled());
    expect(loadComposition).not.toHaveBeenCalled();
  });
});
