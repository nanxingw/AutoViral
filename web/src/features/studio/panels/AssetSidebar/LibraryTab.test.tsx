import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryTab } from "./LibraryTab";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { AssetItem, AssetGroup } from "@/queries/assets";

// #78 — the library tile's "＋" must reach the store's addClip (orphan-wiring).
// We mock the data + heavy children so the test isolates LibraryTab's wiring.

const GROUPS: AssetGroup[] = [
  {
    group: "CLIPS",
    count: 1,
    items: [
      {
        path: "assets/clips/a.mp4",
        url: "/api/works/w1/assets/clips/a.mp4",
        kind: "video",
        ext: "mp4",
        name: "a.mp4",
      } satisfies AssetItem,
    ],
  },
];

vi.mock("@/queries/assets", () => ({
  useWorkAssets: () => ({ data: GROUPS, isLoading: false }),
}));
vi.mock("../../generation/GenerationDialog", () => ({
  GenerationDialog: () => null,
}));
vi.mock("./SearchBox", () => ({ SearchBox: () => null }));
vi.mock("../../media/useGatedMediaSrc", () => ({
  useGatedMediaSrc: () => ({ src: undefined, onSettled: () => {} }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  useComposition.setState({ selection: null });
});

describe("LibraryTab — add asset to timeline (#78)", () => {
  it("clicking a tile's ＋ appends the asset to the timeline via addClip", () => {
    render(wrap(<LibraryTab workId="w1" />));
    const videoTrackBefore = useComposition
      .getState()
      .comp!.tracks.find((t) => t.kind === "video")!;
    expect(videoTrackBefore.clips).toHaveLength(0);

    // The ＋ affordance is labelled with the add-to-timeline string.
    fireEvent.click(screen.getByRole("button", { name: /add to timeline/i }));

    const videoTrackAfter = useComposition
      .getState()
      .comp!.tracks.find((t) => t.kind === "video")!;
    expect(videoTrackAfter.clips).toHaveLength(1);
    expect((videoTrackAfter.clips[0] as { src: string }).src).toBe(
      "assets/clips/a.mp4",
    );
  });

  it("the ＋ does not also open the preview modal (stopPropagation)", () => {
    render(wrap(<LibraryTab workId="w1" />));
    fireEvent.click(screen.getByRole("button", { name: /add to timeline/i }));
    // Preview modal would mount a backdrop testid — it must NOT appear.
    expect(screen.queryByTestId("asset-preview-backdrop")).toBeNull();
  });
});
