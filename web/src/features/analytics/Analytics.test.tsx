import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { mswServer } from "@/test/msw";
import Analytics from "@/pages/Analytics";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Analytics page", () => {
  // Mock data sourced from web/src/test/msw.ts: nickname @alex_creates,
  // avg_digg 2847 (mapped via adapter to summary.avgLikes).
  it("renders hero KPIs and profile when data loaded", async () => {
    render(wrap(<Analytics />));
    await waitFor(() => expect(screen.getAllByText(/@alex_creates/i).length).toBeGreaterThan(0));
    // KPI shows compactNumber(2847) === "2.8K" — proves adapter wired
    // avg_digg (snake_case backend key) through to KPIBar avgLikes prop.
    expect(screen.getByText(/2\.8K/)).toBeInTheDocument();
    // R104 F443 — hero eyebrow no longer falsely claims "last 7 days";
    // shows "LIFETIME" until backend ships time-windowed summaries.
    expect(screen.getByText(/LIFETIME|自有记录以来/i)).toBeInTheDocument();
  });

  // PRD-0006 S2 — demographics cards + 501 refresh CTA deleted; honest empty
  // state + platform-honesty matrix in their place.
  it("renders the platform-honesty matrix and drops the dishonest cards", async () => {
    render(wrap(<Analytics />));
    await waitFor(() => expect(screen.getAllByText(/@alex_creates/i).length).toBeGreaterThan(0));

    // Matrix is present with all four platforms.
    expect(screen.getByText("Douyin")).toBeInTheDocument();
    expect(screen.getByText("TikTok")).toBeInTheDocument();

    // The deleted demographics empty copy must be gone (no fields-no-code-writes
    // cards, no "waiting for background collector" lie).
    expect(screen.queryByText(/waiting for first samples/i)).toBeNull();
    expect(screen.queryByText(/等待后台采集/)).toBeNull();

    // The 501-pointing refresh CTA is gone.
    expect(screen.queryByText(/Open settings/i)).toBeNull();

    // The honest demographics empty state is shown, watermark and all.
    expect(screen.getAllByTestId("empty-state-watermark").length).toBeGreaterThan(0);
  });

  // PRD-0006 S12 — the D3-filtered agent insights render in 最新洞察. (The
  // honesty regression itself lives in insight-guardrail.test.ts; here we prove
  // the page actually surfaces the agent rows the endpoint returns.)
  it("renders the agent-generated insights from /api/analytics/insights", async () => {
    mswServer.use(
      http.get("/api/analytics/insights", () =>
        HttpResponse.json({
          insights: [
            { date: "2026-03-20", body: "埃及奇遇播放 2705 是最高的一条，互动偏低。", tag: "互动钩子" },
          ],
        }),
      ),
    );
    render(wrap(<Analytics />));
    await waitFor(() =>
      expect(screen.getByText(/埃及奇遇播放 2705/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/→ 互动钩子/)).toBeInTheDocument();
    // It is NOT showing the honest empty state for insights when real ones exist.
    expect(screen.queryByText(/No automated insights yet|暂无自动洞察/i)).toBeNull();
  });
});
