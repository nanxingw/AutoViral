import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@/test/msw";
import { useWorks, CREATING_REFETCH_MS, type WorkSummary } from "./works";
import type { ReactNode } from "react";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useWorks", () => {
  it("fetches list of works from /api/works", async () => {
    const { result } = renderHook(() => useWorks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.[0].id).toBe("w1");
  });

  // B3 — Works grid must self-refresh while a work is still building, so the
  // creating → ready flip + the agent-attached cover appear without a reload.
  // We assert the OBSERVABLE behavior: the list refetches on the interval and
  // the new (ready + cover) data lands. The handler flips status on the 2nd
  // poll, mimicking the server finishing the work.
  it("polls while a work is `creating` and surfaces the ready+cover flip without remount", async () => {
    let calls = 0;
    const creating: WorkSummary = {
      id: "wc",
      title: "Building",
      type: "short-video",
      status: "creating",
      thumbnail: null,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const ready: WorkSummary = {
      ...creating,
      status: "ready",
      coverImage: "/api/works/wc/assets/cover.png",
    };
    mswServer.use(
      http.get("/api/works", () => {
        calls += 1;
        // First fetch: still creating. Subsequent polls: finished.
        return HttpResponse.json({ works: [calls === 1 ? creating : ready] });
      }),
    );

    const { result } = renderHook(() => useWorks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.[0].status).toBe("creating"));
    expect(calls).toBe(1);

    // The interval re-arms because a work is creating → it refetches and the
    // status flips to ready with a cover attached, no remount needed.
    await waitFor(
      () => {
        expect(result.current.data?.[0].status).toBe("ready");
        expect(result.current.data?.[0].coverImage).toContain("cover.png");
      },
      { timeout: CREATING_REFETCH_MS * 2 + 2000 },
    );
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  // B3 — the corollary: an idle grid of finished works must NOT keep polling
  // forever. Returning `false` from refetchInterval disables it.
  it("does not keep polling once no work is `creating`", async () => {
    let calls = 0;
    mswServer.use(
      http.get("/api/works", () => {
        calls += 1;
        return HttpResponse.json({
          works: [
            {
              id: "wr",
              title: "Done",
              type: "short-video",
              status: "ready",
              thumbnail: null,
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
        });
      }),
    );

    const { result } = renderHook(() => useWorks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const afterFirst = calls;

    // Wait well past one interval; with no creating work, no extra poll fires.
    await new Promise((r) => setTimeout(r, CREATING_REFETCH_MS + 1500));
    expect(calls).toBe(afterFirst);
  }, CREATING_REFETCH_MS + 4000);
});
