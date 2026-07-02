import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from ".";
import { useComposition } from "../../store";
import { useDive } from "../../dive/diveStore";
import { makeAssetGraph, makeScene } from "../../../../test/composition-fixtures";

// B6 (PRD-0010) — clicking a cluster title in the Dive canvas closes the canvas
// and asks the AssetSidebar to jump to the matching 分镜 card: switch to the
// Script tab AND expand that card. The canvas → sidebar hand-off travels through
// the shared diveStore (pendingSceneJump); this test drives that store request
// and asserts the sidebar reacts.

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ assets: [] })),
  ApiError: class ApiError extends Error {},
}));

// The 剧本 (plan/script.md) editor loads on mount — stub it so the tab renders
// without a real network round-trip.
vi.mock("../../services/script", () => ({
  loadScript: vi.fn(async () => ""),
  saveScript: vi.fn(async () => {}),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useComposition.setState({ comp: null, selection: null });
  useDive.setState({
    open: false,
    view: "scene",
    unassignedCollapsed: true,
    pendingSceneJump: null,
    memoWorkId: null,
  });
});

describe("AssetSidebar — cluster-title scene jump (B6)", () => {
  it("a pending scene jump switches to the Script tab and expands the target card", () => {
    const comp = makeAssetGraph({ ids: ["g1"] });
    comp.scenes = [
      makeScene({ id: "sc1", order: 0, title: "Opening" }),
      makeScene({ id: "sc2", order: 1, title: "The turn" }),
    ];
    useComposition.setState({ comp, selection: null });

    wrap(<AssetSidebar workId="w" />);

    // Starts on the Library tab — no scene cards yet.
    expect(screen.queryByTestId("scene-card")).toBeNull();

    // Simulate a cluster-title click in the canvas.
    act(() => {
      useDive.getState().jumpToScene("sc2");
    });

    // The Script tab is now active and its cards render.
    const cards = screen.getAllByTestId("scene-card");
    expect(cards.length).toBe(2);
    // The targeted card is expanded; the other stays collapsed.
    const sc2 = cards.find((c) => c.getAttribute("data-scene-id") === "sc2");
    const sc1 = cards.find((c) => c.getAttribute("data-scene-id") === "sc1");
    expect(sc2?.getAttribute("data-expanded")).toBe("true");
    expect(sc1?.getAttribute("data-expanded")).toBe("false");
  });

  it("consumes the pending jump after handling it (so a later manual tab change is not re-hijacked)", () => {
    const comp = makeAssetGraph({ ids: ["g1"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, title: "Opening" })];
    useComposition.setState({ comp, selection: null });

    wrap(<AssetSidebar workId="w" />);
    act(() => {
      useDive.getState().jumpToScene("sc1");
    });
    expect(useDive.getState().pendingSceneJump).toBeNull();
  });
});
