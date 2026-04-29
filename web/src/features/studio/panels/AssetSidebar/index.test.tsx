import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from "./index";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({
    assets: [
      "assets/clips/intro.mp4",
      "output/final.mp4",
      "assets/images/cover.png",
    ],
  })),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AssetSidebar", () => {
  it("renders Assets header and bucketed group chips", async () => {
    wrap(<AssetSidebar workId="w1" />);
    expect(await screen.findByText("Assets")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/CLIPS · 2/)).toBeTruthy();
      expect(screen.getByText(/IMAGES · 1/)).toBeTruthy();
    });
  });

  it("shows NO ASSETS empty state when no buckets", async () => {
    const mod = await import("@/lib/api");
    (mod.apiFetch as any).mockResolvedValueOnce({ assets: [] });
    wrap(<AssetSidebar workId="w1" />);
    await waitFor(() => expect(screen.getByText("NO ASSETS")).toBeTruthy());
  });

  it("clicking the '+' button opens the GenerationDialog (Phase 2 §2.5)", async () => {
    wrap(<AssetSidebar workId="w1" />);
    const plus = await screen.findByRole("button", { name: /upload/i });
    fireEvent.click(plus);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });
});
