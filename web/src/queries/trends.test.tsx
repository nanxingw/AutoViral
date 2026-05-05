import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { usePlatformTrends } from "./trends";
import { mswServer } from "@/test/msw";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("usePlatformTrends platform normalisers", () => {
  it("parses xiaohongshu videos[] with 万 suffix into a numeric views field", async () => {
    mswServer.use(
      http.get("/api/trends/xiaohongshu", () =>
        HttpResponse.json({
          platform: "xiaohongshu",
          videos: [
            { title: "Video A", views: "12.3万", likes: "4567", comments: "100" },
          ],
          refreshedAt: "2026-04-25T12:00:00Z",
        }),
      ),
    );
    const { result } = renderHook(() => usePlatformTrends("xiaohongshu"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items).toHaveLength(1);
    expect(result.current.data!.items[0].views).toBe(123_000);
    expect(result.current.data!.items[0].likes).toBe(4567);
    expect(result.current.data!.items[0].rank).toBe(1);
    expect(result.current.data!.items[0].thumbAspect).toBe("9:16");
  });

  it("converts douyin topics[] heat to likes (heat * 1000)", async () => {
    mswServer.use(
      http.get("/api/trends/douyin", () =>
        HttpResponse.json({
          platform: "douyin",
          topics: [{ rank: 3, title: "Topic A", heat: 42, competition: "low" }],
          refreshedAt: "2026-04-25T12:00:00Z",
        }),
      ),
    );
    const { result } = renderHook(() => usePlatformTrends("douyin"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items[0].rank).toBe(3);
    expect(result.current.data!.items[0].likes).toBe(42_000);
  });

  it("returns empty items when backend 404s (no data yet)", async () => {
    mswServer.use(
      http.get("/api/trends/youtube", () => new HttpResponse(null, { status: 404 })),
    );
    const { result } = renderHook(() => usePlatformTrends("youtube"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items).toEqual([]);
  });
});
