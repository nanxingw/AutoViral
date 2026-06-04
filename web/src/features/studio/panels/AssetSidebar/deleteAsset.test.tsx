import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryTab } from "./LibraryTab";
import {
  findClipsReferencingAsset,
  findProvenanceAssetIds,
  deleteAssetUrl,
} from "./deleteAsset";
import { useComposition } from "../../store";
import { makeEmptyComposition, type Clip } from "../../types";
import type { AssetItem, AssetGroup } from "@/queries/assets";

// I18 (PRD-0003 §3.2) — the library delete control must (1) two-step confirm,
// (2) call DELETE /api/works/:id/assets/<path>, (3) call store.removeAsset /
// remove referencing clips on success, and (4) warn when an asset is
// referenced by timeline clips (WARN-then-cascade policy).

const VIDEO_ASSET: AssetItem = {
  path: "assets/clips/a.mp4",
  url: "/api/works/w1/assets/assets/clips/a.mp4",
  kind: "video",
  ext: "mp4",
  name: "a.mp4",
};

const GROUPS: AssetGroup[] = [
  { group: "CLIPS", count: 1, items: [VIDEO_ASSET] },
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

const jsonHeaders = {
  get: (k: string) =>
    k.toLowerCase() === "content-type" ? "application/json" : null,
};

/** A video clip whose src points at the library asset (workspace-relative). */
function clipReferencing(): Clip {
  return {
    id: "clip-1",
    kind: "video",
    src: "assets/clips/a.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as Clip;
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  useComposition.setState({ selection: null });
  vi.restoreAllMocks();
});

describe("findClipsReferencingAsset / findProvenanceAssetIds", () => {
  it("matches a clip stored as a workspace-relative path", () => {
    const store = useComposition.getState();
    const videoTrack = store.comp!.tracks.find((t) => t.kind === "video")!;
    store.addClip(videoTrack.id, clipReferencing());
    const comp = useComposition.getState().comp!;
    expect(findClipsReferencingAsset(comp, VIDEO_ASSET)).toEqual(["clip-1"]);
  });

  it("matches a clip already stored as the served /api/works URL", () => {
    const store = useComposition.getState();
    const videoTrack = store.comp!.tracks.find((t) => t.kind === "video")!;
    const c = clipReferencing();
    (c as { src: string }).src = "/api/works/w1/assets/assets/clips/a.mp4";
    store.addClip(videoTrack.id, c);
    const comp = useComposition.getState().comp!;
    expect(findClipsReferencingAsset(comp, VIDEO_ASSET)).toEqual(["clip-1"]);
  });

  it("does not match an unrelated clip", () => {
    const store = useComposition.getState();
    const videoTrack = store.comp!.tracks.find((t) => t.kind === "video")!;
    const c = clipReferencing();
    (c as { src: string }).src = "assets/clips/other.mp4";
    store.addClip(videoTrack.id, c);
    const comp = useComposition.getState().comp!;
    expect(findClipsReferencingAsset(comp, VIDEO_ASSET)).toEqual([]);
  });

  it("matches a provenance asset entry by resolved uri", () => {
    const store = useComposition.getState();
    store.addAsset({
      id: "av-1",
      uri: "assets/clips/a.mp4",
      kind: "video",
      metadata: {},
      status: "ready",
    });
    const comp = useComposition.getState().comp!;
    expect(findProvenanceAssetIds(comp, VIDEO_ASSET)).toEqual(["av-1"]);
  });
});

describe("deleteAssetUrl", () => {
  it("encodes each path segment of the work-relative path", () => {
    expect(deleteAssetUrl("w1", VIDEO_ASSET)).toBe(
      "/api/works/w1/assets/assets/clips/a.mp4",
    );
  });
});

describe("LibraryTab — delete an asset (I18)", () => {
  it("opens a two-step confirm and only deletes on Confirm", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ deleted: true, path: "assets/clips/a.mp4" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<LibraryTab workId="w1" />));

    // No request before the user confirms (step one is just opening the dialog).
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("asset-delete-confirm")).toBeInTheDocument();

    // Step two — explicit Confirm fires the DELETE.
    fireEvent.click(screen.getByTestId("asset-delete-confirm"));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/works/w1/assets/assets/clips/a.mp4",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("cancelling the confirm makes no request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<LibraryTab workId="w1" />));
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("asset-delete-confirm")).toBeNull();
  });

  it("on success, removes the referencing clip AND the provenance asset", async () => {
    // Seed: one clip + one provenance entry both pointing at the asset.
    const store0 = useComposition.getState();
    const videoTrack = store0.comp!.tracks.find((t) => t.kind === "video")!;
    store0.addClip(videoTrack.id, clipReferencing());
    store0.addAsset({
      id: "av-1",
      uri: "assets/clips/a.mp4",
      kind: "video",
      metadata: {},
      status: "ready",
    });
    expect(
      useComposition
        .getState()
        .comp!.tracks.find((t) => t.kind === "video")!.clips,
    ).toHaveLength(1);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ deleted: true, path: "assets/clips/a.mp4" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(wrap(<LibraryTab workId="w1" />));
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    fireEvent.click(screen.getByTestId("asset-delete-confirm"));

    // Cascade: the referencing clip and the provenance asset are both gone.
    await vi.waitFor(() => {
      const comp = useComposition.getState().comp!;
      expect(comp.tracks.find((t) => t.kind === "video")!.clips).toHaveLength(0);
      expect(comp.assets).toHaveLength(0);
    });
  });

  it("warns how many clips reference the asset (does not silently break the timeline)", () => {
    const store0 = useComposition.getState();
    const videoTrack = store0.comp!.tracks.find((t) => t.kind === "video")!;
    store0.addClip(videoTrack.id, clipReferencing());

    render(wrap(<LibraryTab workId="w1" />));
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));

    // The warning body must surface the referenced-clip count (WARN-then-cascade).
    const body = screen.getByText(/used by 1 clip/i);
    expect(body).toBeInTheDocument();
    // And the confirm button switches to the cascade copy.
    expect(
      screen.getByRole("button", { name: /delete asset \+ clips/i }),
    ).toBeInTheDocument();
  });

  it("an unreferenced asset shows the plain delete copy (no clip warning)", () => {
    render(wrap(<LibraryTab workId="w1" />));
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    expect(screen.queryByText(/used by .* clip/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /^delete$/i }),
    ).toBeInTheDocument();
  });
});
