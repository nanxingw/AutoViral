import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useBridgeEvents } from "../useBridgeEvents";
import { useComposition } from "@/features/studio/store";
import { useToastStore } from "@/stores/toast";

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

// S5 (PRD-0007) — plan-changed refetches plan/script.md into the script store.
// Mock the script service + the script store so we can assert the refetch
// pushed the new markdown into state without touching the network.
const loadScript = vi.fn(async (_workId?: string) => "# fresh markdown\n");
vi.mock("@/features/studio/services/script", () => ({
  loadScript: (workId: string) => loadScript(workId),
}));
const setScript = vi.fn();
vi.mock("@/features/studio/scriptStore", () => ({
  useScript: {
    getState: () => ({ setScript }),
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

  // B4 (PRD-0010) — a freshly generated asset costs money (video/image/tts/bgm
  // instrumentation from B1/B2), so asset-added must also refresh the per-work
  // cost badge without a page reload.
  it("asset-added ALSO invalidates the [\"cost\", workId] badge query", async () => {
    const { invalidateSpy } = renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "asset-added",
        workId: "w_test",
        ts: Date.now(),
        payload: { kind: "image", uri: "assets/gen/x.png", origin: "generate" },
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cost", "w_test"] });
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

describe("useBridgeEvents · plan-changed (S5 / PRD-0007)", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadScript.mockClear();
    setScript.mockClear();
    loadComposition.mockClear();
  });
  afterEach(() => {
    delete (globalThis as any).WebSocket;
    vi.restoreAllMocks();
  });

  it("plan-changed refetches plan/script.md and loads it into the script store", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "plan-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: null,
      });
    });
    await waitFor(() => expect(loadScript).toHaveBeenCalledWith("w_test"));
    // setScript now stamps the owning workId (tenant-aware store) so a
    // plan-changed for w_test loads under w_test, never bleeds to another work.
    await waitFor(() =>
      expect(setScript).toHaveBeenCalledWith("w_test", "# fresh markdown\n"),
    );
  });

  it("plan-changed does NOT trigger the composition refetch (scoped to the script)", async () => {
    renderBridge("w_test");
    act(() => {
      MockWS.instances[0].emit({
        type: "plan-changed",
        workId: "w_test",
        ts: Date.now(),
        payload: null,
      });
    });
    await waitFor(() => expect(loadScript).toHaveBeenCalled());
    expect(loadComposition).not.toHaveBeenCalled();
  });
});

describe("useBridgeEvents · reconnect after socket drop", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadComposition.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
    vi.restoreAllMocks();
  });

  it("schedules a reconnect when the server drops the socket", () => {
    renderBridge("w_test");
    expect(MockWS.instances.length).toBe(1);
    act(() => {
      MockWS.instances[0].onopen?.(new Event("open"));
      MockWS.instances[0].onclose?.(new CloseEvent("close"));
    });
    // Backoff starts at 1s — after it elapses a fresh socket must exist.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockWS.instances.length).toBe(2);
    expect(MockWS.instances[1].url).toContain("/ws/bridge/w_test");
  });

  it("runs a full catch-up refetch on RE-connect (missed events have no replay)", () => {
    const { invalidateSpy } = renderBridge("w_test");
    act(() => {
      MockWS.instances[0].onopen?.(new Event("open"));
    });
    // First open is NOT a reconnect — no catch-up churn on initial mount.
    expect(loadComposition).not.toHaveBeenCalled();
    act(() => {
      MockWS.instances[0].onclose?.(new CloseEvent("close"));
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      MockWS.instances[1].onopen?.(new Event("open"));
    });
    // Reconnect → composition refetch + assets-library + cost-badge
    // invalidation fire (events missed while down have no replay).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["assets", "w_test"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cost", "w_test"] });
  });

  it("does NOT reconnect after unmount (disposed guard)", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useBridgeEvents("w_test"), { wrapper });
    expect(MockWS.instances.length).toBe(1);
    unmount(); // cleanup closes the socket → onclose fires synchronously
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(MockWS.instances.length).toBe(1);
  });
});

// ── PRD-0014 S6b review findings 2 & 3 ───────────────────────────────────────
// The video "add to timeline" path no longer writes the clip locally: it awaits
// the bridge import, and the clip appears ONLY when the composition-changed
// broadcast refetches from disk. That makes the refetch path load-bearing, and
// surfaced two gaps:
//   • finding 3 — a refetch fired for the OLD work must not overwrite the store
//     after the user switched works (the async result would clobber the new work).
//   • finding 2 — a refetch that keeps failing must surface a user-visible error
//     (and retry), not silently swallow so the UI never shows the imported clip.
describe("useBridgeEvents · composition refetch robustness (S6b findings 2 & 3)", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWS;
    MockWS.instances = [];
    loadComposition.mockReset();
    loadComposition.mockResolvedValue(null);
    useToastStore.getState().clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
    vi.restoreAllMocks();
  });

  it("finding 3 — a stale refetch for a switched-away work never overwrites the store", async () => {
    // Arrange: work A's composition-changed fires an in-flight refetch that will
    // resolve only AFTER we switch to work B.
    let resolveA: ((v: any) => void) | undefined;
    loadComposition.mockImplementationOnce(
      () => new Promise((r) => (resolveA = r)) as Promise<null>,
    );
    const storeLoad = vi
      .spyOn(useComposition.getState(), "loadComposition")
      .mockImplementation(() => {});

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(
      ({ id }: { id: string }) => useBridgeEvents(id),
      { wrapper, initialProps: { id: "w_A" } },
    );

    act(() => {
      MockWS.instances[0].emit({
        type: "composition-changed",
        workId: "w_A",
        ts: Date.now(),
        payload: {},
      });
    });
    // Wait until the (dynamic-import) refetch has actually invoked the service —
    // only then is the pending promise's resolver captured.
    await waitFor(() => expect(loadComposition).toHaveBeenCalledWith("w_A"));

    // The user switches to work B — the w_A effect is torn down (disposed).
    rerender({ id: "w_B" });

    // The w_A refetch now resolves LATE, carrying w_A's composition.
    await act(async () => {
      resolveA?.({
        workId: "w_A",
        fps: 30,
        width: 1080,
        height: 1920,
        duration: 0,
        tracks: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale result must be dropped — the store was never loaded with w_A.
    expect(storeLoad).not.toHaveBeenCalled();
    unmount();
    storeLoad.mockRestore();
  });

  it("finding 2 — retries then surfaces an error toast when the refetch keeps failing", async () => {
    vi.useFakeTimers();
    loadComposition.mockReset();
    loadComposition.mockRejectedValue(new Error("disk unreadable"));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(() => useBridgeEvents("w_test"), { wrapper });

    MockWS.instances[0].emit({
      type: "composition-changed",
      workId: "w_test",
      ts: Date.now(),
      payload: {},
    });

    // Fast-forward through every retry backoff. The initial attempt + retries all
    // reject; the final failure raises the toast (no timer of its own).
    await vi.advanceTimersByTimeAsync(10_000);

    // It genuinely retried (>1 attempt), not a single silent swallow.
    expect(loadComposition.mock.calls.length).toBeGreaterThan(1);
    const toasts = useToastStore.getState().entries;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("error");
  });
});
