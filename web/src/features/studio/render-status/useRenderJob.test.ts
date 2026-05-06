import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRenderJob } from "./useRenderJob";

// Fake WebSocket — minimal EventTarget-like.
// happy-dom does not provide a usable WebSocket; inline a tiny one.
class FakeWs {
  static instances: FakeWs[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(_: string) {
    /* noop */
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  FakeWs.instances = [];
  vi.stubGlobal("WebSocket", FakeWs);
  const fetchMock = vi.fn(async (url: unknown, opts?: { method?: string }) => {
    if (typeof url === "string" && url.startsWith("/api/render/jobs/") && opts?.method === "DELETE") {
      return {
        ok: true,
        json: async () => ({
          id: url.split("/").pop(),
          status: "cancelled",
          progress: 0,
          log: [],
          workId: "w-1",
          type: "full",
          createdAt: "x",
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        id: "job_1",
        status: "queued",
        progress: 0,
        log: [],
        workId: "w-1",
        type: "full",
        createdAt: "x",
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRenderJob", () => {
  it("subscribes to /ws/render/jobs/:id and reflects pushed events", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    expect(FakeWs.instances[0]!.url).toMatch(/\/ws\/render\/jobs\/job_1$/);

    act(() =>
      FakeWs.instances[0]!.push({ at: "t", status: "running", progress: 0.3, stage: "render" }),
    );
    await waitFor(() => expect(result.current.job?.status).toBe("running"));
    expect(result.current.job?.progress).toBe(0.3);
    expect(result.current.job?.stage).toBe("render");
  });

  it("closes the socket on terminal status", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    act(() => FakeWs.instances[0]!.push({ at: "t", status: "done", progress: 1 }));
    await waitFor(() => expect(FakeWs.instances[0]!.closed).toBe(true));
    expect(result.current.job?.status).toBe("done");
  });

  it("disposes on unmount", async () => {
    const { unmount } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    unmount();
    await waitFor(() => expect(FakeWs.instances[0]!.closed).toBe(true));
  });

  it("cancel() POSTs DELETE and updates state", async () => {
    const { result } = renderHook(() => useRenderJob("job_1"));
    await waitFor(() => expect(FakeWs.instances).toHaveLength(1));
    await act(async () => {
      await result.current.cancel();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/render/jobs/job_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
