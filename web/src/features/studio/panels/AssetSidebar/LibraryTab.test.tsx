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

describe("LibraryTab — upload own media (#91)", () => {
  const jsonHeaders = {
    get: (k: string) =>
      k.toLowerCase() === "content-type" ? "application/json" : null,
  };

  it("exposes distinct Upload and Generate buttons (a11y mislabel fixed)", () => {
    render(wrap(<LibraryTab workId="w1" />));
    // Pre-fix the only "Upload"-labelled control opened the AI generator.
    expect(screen.getByRole("button", { name: /upload your own media/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });

  it("picking a file POSTs it to the upload endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ success: true, path: "assets/video/a.mp4", url: "/u" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<LibraryTab workId="w1" />));
    const input = screen.getByTestId("asset-upload-input") as HTMLInputElement;
    const f = new File([new Uint8Array([1, 2, 3])], "a.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [f] } });

    // Upload fires (sequential mutation → fetch hit).
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/works/w1/assets/upload",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("rejects an oversized file client-side without hitting the network", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<LibraryTab workId="w1" />));
    const input = screen.getByTestId("asset-upload-input") as HTMLInputElement;
    const big = new File([new Uint8Array([1])], "huge.mp4", { type: "video/mp4" });
    // 100MB cap + 1 — defineProperty since we can't allocate 100MB in a test.
    Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/huge\.mp4/);
  });
});
