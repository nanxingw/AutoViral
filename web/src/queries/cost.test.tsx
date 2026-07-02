import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCostSummary, costKey, formatUsd, type CostSummary } from "./cost";

// B4 (PRD-0010) — the per-work cost badge query + amount formatter. The hook
// reads the B1 summary endpoint (GET /api/works/:id/cost); the formatter is the
// single source of truth for how a USD amount renders in the badge + breakdown.

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("formatUsd", () => {
  it("shows two decimals for normal amounts", () => {
    expect(formatUsd(0.04)).toBe("$0.04");
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatUsd(12.5)).toBe("$12.50");
  });

  it("renders zero / non-finite as $0.00", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-3)).toBe("$0.00");
    expect(formatUsd(NaN)).toBe("$0.00");
  });

  it("keeps extra precision for sub-cent amounts so cheap agent turns don't read as $0.00", () => {
    expect(formatUsd(0.003)).toBe("$0.003");
    expect(formatUsd(0.005)).toBe("$0.005");
    expect(formatUsd(0.0012)).toBe("$0.0012");
  });
});

describe("costKey", () => {
  it("is a stable ['cost', workId] tuple", () => {
    expect(costKey("w1")).toEqual(["cost", "w1"]);
  });
});

describe("useCostSummary", () => {
  it("fetches the per-work cost summary from the B1 endpoint", async () => {
    const summary: CostSummary = {
      workId: "w1",
      totalUsd: 0.12,
      estimated: true,
      count: 3,
      byKind: [
        { kind: "video", usd: 0.08, count: 1, estimated: false },
        { kind: "bgm", usd: 0.04, count: 2, estimated: true },
      ],
    };
    apiFetch.mockResolvedValueOnce(summary);
    const { result } = renderHook(() => useCostSummary("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/api/works/w1/cost");
    expect(result.current.data).toEqual(summary);
  });

  it("is disabled (no fetch) when workId is null", () => {
    renderHook(() => useCostSummary(null), { wrapper });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
