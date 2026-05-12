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
  it("returns xiaohongshu items with correct metrics", async () => {
    mswServer.use(
      http.get("/api/trends/xiaohongshu", () =>
        HttpResponse.json({
          platform: "xiaohongshu",
          items: [{
            id: "xhs_a", platform: "xiaohongshu", title: "T",
            sourceUrl: "https://x/", source: "scraper",
            scrapedAt: "2026-05-12T10:00:00.000Z",
            cover: { url: "https://x/c.jpg", aspect: "9:16" },
            metrics: { views: 100, likes: 50, comments: 5, shares: null, fetchedAt: "2026-05-12T10:00:00.000Z" },
            analysis: { heat: 4, competition: "中", opportunity: "金矿",
              description: "D".repeat(30), tags: ["a","b","c"], contentAngles: ["x","y"],
              exampleHook: "Hook.", category: "tech" },
          }],
          collectedAt: "2026-05-12T10:00:00.000Z",
          pipelineStatus: "ok",
        }),
      ),
    );
    const { result } = renderHook(() => usePlatformTrends("xiaohongshu"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items).toHaveLength(1);
    expect(result.current.data!.items[0].metrics?.views).toBe(100);
    expect(result.current.data!.items[0].metrics?.likes).toBe(50);
    expect(result.current.data!.items[0].platform).toBe("xiaohongshu");
    expect(result.current.data!.items[0].cover.aspect).toBe("9:16");
  });

  it("returns douyin items with correct analysis heat", async () => {
    mswServer.use(
      http.get("/api/trends/douyin", () =>
        HttpResponse.json({
          platform: "douyin",
          items: [{
            id: "dy_b", platform: "douyin", title: "Topic A",
            sourceUrl: "https://dy/", source: "scraper",
            scrapedAt: "2026-05-12T10:00:00.000Z",
            cover: { url: "https://dy/c.jpg", aspect: "9:16" },
            metrics: { views: null, likes: null, comments: null, shares: null, fetchedAt: "2026-05-12T10:00:00.000Z" },
            analysis: { heat: 3, competition: "低", opportunity: "蓝海",
              description: "D".repeat(30), tags: ["a","b"], contentAngles: ["x"],
              exampleHook: "Hook.", category: "entertainment" },
          }],
          collectedAt: "2026-05-12T10:00:00.000Z",
          pipelineStatus: "ok",
        }),
      ),
    );
    const { result } = renderHook(() => usePlatformTrends("douyin"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items[0].title).toBe("Topic A");
    expect(result.current.data!.items[0].analysis.heat).toBe(3);
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
