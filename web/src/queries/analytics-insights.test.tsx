import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { mswServer } from "@/test/msw";
import { useHonestInsights } from "./analytics-insights";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useHonestInsights", () => {
  it("returns the D3-filtered agent insights from the endpoint", async () => {
    mswServer.use(
      http.get("/api/analytics/insights", () =>
        HttpResponse.json({
          insights: [
            { date: "2026-03-20", body: "埃及奇遇播放 2705 最高，互动偏低。", tag: "互动" },
          ],
        }),
      ),
    );
    const { result } = renderHook(() => useHonestInsights(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].body).toContain("2705");
    expect(result.current.data?.[0].tag).toBe("互动");
  });

  it("returns an empty array (not undefined) when the endpoint yields none", async () => {
    mswServer.use(
      http.get("/api/analytics/insights", () => HttpResponse.json({ insights: [] })),
    );
    const { result } = renderHook(() => useHonestInsights(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("degrades to [] when the payload is malformed (never throws into the page)", async () => {
    mswServer.use(
      http.get("/api/analytics/insights", () => HttpResponse.json({})),
    );
    const { result } = renderHook(() => useHonestInsights(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
