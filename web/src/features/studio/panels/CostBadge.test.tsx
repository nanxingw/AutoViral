import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CostBadge } from "./CostBadge";
import type { CostSummary } from "@/queries/cost";

// B4 (PRD-0010) — Studio/Editor per-work cost badge + breakdown panel. Tests run
// in the en locale (web/src/test/setup forces it), so we assert the English
// strings. The badge reads the B1 summary endpoint via useCostSummary; we mock
// apiFetch to drive it (MSW is in error-on-unhandled mode).

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function withQueryClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const NONEMPTY: CostSummary = {
  workId: "w1",
  totalUsd: 0.12,
  estimated: true,
  count: 3,
  byKind: [
    { kind: "video", usd: 0.08, count: 1, estimated: false },
    { kind: "bgm", usd: 0.04, count: 2, estimated: true },
  ],
};

const EMPTY: CostSummary = {
  workId: "w1",
  totalUsd: 0,
  estimated: false,
  count: 0,
  byKind: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

async function renderBadge(summary: CostSummary) {
  apiFetch.mockResolvedValue(summary);
  render(withQueryClient(<CostBadge workId="w1" />));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith("/api/works/w1/cost"),
  );
}

describe("CostBadge", () => {
  it("shows the work's total cost, formatted", async () => {
    await renderBadge(NONEMPTY);
    const badge = await screen.findByTestId("cost-badge");
    await waitFor(() => expect(badge.textContent).toContain("$0.12"));
  });

  it("flags the badge as estimated when any event was estimated", async () => {
    await renderBadge(NONEMPTY);
    expect(await screen.findByTestId("cost-badge-estimated")).toBeInTheDocument();
  });

  it("does NOT flag estimated when every event is a real metered charge", async () => {
    await renderBadge({
      ...NONEMPTY,
      estimated: false,
      byKind: [{ kind: "video", usd: 0.08, count: 1, estimated: false }],
    });
    await screen.findByTestId("cost-badge");
    expect(screen.queryByTestId("cost-badge-estimated")).not.toBeInTheDocument();
  });

  it("opens the breakdown panel on click, grouped by kind with localized names", async () => {
    await renderBadge(NONEMPTY);
    // Panel is closed initially.
    expect(screen.queryByTestId("cost-detail-panel")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("cost-badge"));
    const panel = await screen.findByTestId("cost-detail-panel");
    expect(panel).toBeInTheDocument();
    // Per-kind rows (localized labels + amounts).
    const video = await screen.findByTestId("cost-kind-video");
    const bgm = await screen.findByTestId("cost-kind-bgm");
    expect(video.textContent).toContain("Video");
    expect(video.textContent).toContain("$0.08");
    expect(bgm.textContent).toContain("Music");
    expect(bgm.textContent).toContain("$0.04");
  });

  it("shows the accounting-origin note in the panel", async () => {
    await renderBadge(NONEMPTY);
    fireEvent.click(await screen.findByTestId("cost-badge"));
    const note = await screen.findByTestId("cost-since-note");
    expect(note.textContent).toMatch(/v0\.1\.8/);
  });

  it("shows the estimated-methodology note when any amount is estimated", async () => {
    await renderBadge(NONEMPTY);
    fireEvent.click(await screen.findByTestId("cost-badge"));
    expect(await screen.findByTestId("cost-estimated-note")).toBeInTheDocument();
  });

  it("renders the empty zero-state when the ledger has no events", async () => {
    await renderBadge(EMPTY);
    const badge = await screen.findByTestId("cost-badge");
    await waitFor(() => expect(badge.textContent).toContain("$0.00"));
    fireEvent.click(badge);
    const empty = await screen.findByTestId("cost-empty");
    expect(empty.textContent).toMatch(/no cost yet/i);
    // No kind rows in the empty state.
    expect(screen.queryByTestId("cost-kind-video")).not.toBeInTheDocument();
  });
});
