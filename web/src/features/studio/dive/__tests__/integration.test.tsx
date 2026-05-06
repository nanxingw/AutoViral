import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from "../../panels/AssetSidebar";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ assets: [] })),
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
  useComposition.setState({ comp: null, selection: null });
});

describe("Phase 5 acceptance criteria", () => {
  it("AC1: 2-sibling variant switch through Inspector tab", () => {
    // Setup: a clip bound to "alpha" with 2 siblings (beta, gamma).
    const comp = makeAssetGraph({
      ids: ["root", "alpha", "beta", "gamma"],
      edges: [["root", "alpha"], ["root", "beta"], ["root", "gamma"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });

    wrap(<AssetSidebar workId="w" />);

    // Inspector tab auto-activates because selection is set.
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
    expect(screen.getByTestId("variant-tile-gamma")).toBeInTheDocument();

    // Click USE THIS on beta.
    fireEvent.click(screen.getByTestId("use-variant-beta"));

    // Verify the store reflects the rebind.
    const updated = useComposition.getState().comp!.tracks[0].clips[0];
    if (updated.kind === "video") {
      expect(updated.src).toBe("/assets/beta.png");
    } else {
      throw new Error(`expected video clip, got ${updated.kind}`);
    }

    // Verify UI rerendered against the new binding
    expect(screen.queryByTestId("variant-tile-beta")).toBeNull(); // beta is now CURRENT, not a sibling
    expect(screen.getByTestId("variant-tile-alpha")).toBeInTheDocument(); // alpha now a sibling
    expect(screen.getByTestId("variant-tile-gamma")).toBeInTheDocument();
  });

  it("AC2: DiveCanvas opens with full graph + USE THIS rebinds from a descendant node", () => {
    const comp = makeAssetGraph({
      ids: ["alpha", "beta", "gamma"],
      edges: [["alpha", "beta"], ["beta", "gamma"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });

    wrap(<AssetSidebar workId="w" />);

    // Open the dive modal from Inspector.
    fireEvent.click(screen.getByRole("button", { name: /open in dive/i }));

    // All 3 nodes render.
    expect(screen.getByTestId("dive-node-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-beta")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-gamma")).toBeInTheDocument();

    // Click USE on a descendant.
    fireEvent.click(screen.getByTestId("dive-use-gamma"));

    const updated = useComposition.getState().comp!.tracks[0].clips[0];
    if (updated.kind === "video") {
      expect(updated.src).toBe("/assets/gamma.png");
    } else {
      throw new Error(`expected video clip, got ${updated.kind}`);
    }
  });
});
