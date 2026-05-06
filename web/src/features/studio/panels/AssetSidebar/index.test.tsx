import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from "./index";
import { useComposition } from "@/features/studio/store";
import { makeAssetGraph, makeVideoClip } from "../../../../test/composition-fixtures";

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

beforeEach(() => {
  vi.clearAllMocks();
  // Reset selection so existing AssetSidebar tests start on the Library tab.
  useComposition.setState({ comp: null, selection: null });
});

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

describe("AssetSidebar tabs (Phase 5.B)", () => {
  it("starts on the Library tab when nothing is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    wrap(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("auto-activates the Inspector tab when a clip becomes selected", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: null });
    wrap(<AssetSidebar workId="w" />);
    // Trigger the store update in act() so the effect flushes synchronously.
    act(() => {
      useComposition.setState({ selection: "c" });
    });
    expect(screen.getByRole("tab", { name: /inspector/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("manual click on Library tab keeps the user's choice", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: "c" });
    wrap(<AssetSidebar workId="w" />);
    // Effect fires on mount, then user toggles back.
    fireEvent.click(screen.getByRole("tab", { name: /library/i }));
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
