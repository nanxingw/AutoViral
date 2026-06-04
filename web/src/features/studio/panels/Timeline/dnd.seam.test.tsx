import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Track } from "./Track";
import { Clip } from "./Clip";
import { LibraryTab } from "../AssetSidebar/LibraryTab";
import { useComposition } from "../../store";
import { TIMELINE_DND_MIME, readDragPayload } from "./dnd";
import { makeEmptyComposition, type VideoClip, type AudioClip } from "../../types";
import type { AssetGroup, AssetItem } from "@/queries/assets";

// Asset library fixture for the AssetTile drag-source test. Mirrors
// LibraryTab.test.tsx's harness (mock the data + heavy children) so we can
// render the real tile and assert its native HTML5 drag payload.
const ASSET_GROUPS: AssetGroup[] = [
  {
    group: "CLIPS",
    count: 1,
    items: [
      {
        path: "assets/clips/a.mp4",
        url: "/api/works/w/assets/clips/a.mp4",
        kind: "video",
        ext: "mp4",
        name: "a.mp4",
      } satisfies AssetItem,
    ],
  },
];
vi.mock("@/queries/assets", () => ({
  useWorkAssets: () => ({ data: ASSET_GROUPS, isLoading: false }),
}));
// vi.mock specifiers resolve relative to THIS test file. Timeline/ and
// AssetSidebar/ are siblings under panels/, so the module LibraryTab imports as
// "../../generation/GenerationDialog" is the same module from here too.
vi.mock("../../generation/GenerationDialog", () => ({
  GenerationDialog: () => null,
}));
vi.mock("../AssetSidebar/SearchBox", () => ({ SearchBox: () => null }));
vi.mock("../../media/useGatedMediaSrc", () => ({
  useGatedMediaSrc: () => ({ src: undefined, onSettled: () => {} }),
}));

function wrapQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

// I19/I20 — the React seam between the pure resolver (dnd.test.ts) and the
// store. dnd.test.ts proves resolveDrop/canAcceptDrop; THIS file proves the
// components actually wire those helpers to dragstart/dragover/drop — exactly
// the gap that let I20's clip drag-source ship unwired (Clip imported
// writeDragPayload but never called it). jsdom can't synthesise a real drag
// image, but a fake DataTransfer with get/setData + fireEvent.drag* is enough
// to exercise the handlers.

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

/** Minimal stand-in for a DataTransfer that survives jsdom's write-only one. */
function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (t: string, d: string) => void store.set(t, d),
    getData: (t: string) => store.get(t) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
}

// Capture the pristine store actions ONCE so each test starts from the real
// implementations. Tests below inject vi.fn() mocks via setState (zustand
// merges, so an injected mock would otherwise leak into later tests); restoring
// here keeps every test isolated.
const realAddClip = useComposition.getState().addClip;
const realMoveClipToTrack = useComposition.getState().moveClipToTrack;

beforeEach(() => {
  // Default lanes: V1 (video) / A1·BGM (audio) / A2·VO (audio) / CC1 (text).
  // The two audio lanes give us a clean same-kind track pair for the move test.
  const c = makeEmptyComposition({ workId: "w" });
  useComposition.setState({
    comp: c,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    dragState: null,
    addClip: realAddClip,
    moveClipToTrack: realMoveClipToTrack,
  });
});

function videoTrack() {
  return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
}
function audioTracks() {
  return useComposition.getState().comp!.tracks.filter((t) => t.kind === "audio");
}

describe("AssetTile drag source (I19 seam)", () => {
  it("dragStart on a placeable tile writes an asset payload with its path + kind", () => {
    useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w" }));
    const { getByLabelText } = render(wrapQuery(<LibraryTab workId="w" />));
    // The tile root is a role=button labelled "Preview {name}".
    const tile = getByLabelText("Preview a.mp4");
    const dt = fakeDataTransfer();
    fireEvent.dragStart(tile, { dataTransfer: dt });

    expect(readDragPayload(dt)).toEqual({
      source: "asset",
      assetPath: "assets/clips/a.mp4",
      assetKind: "video",
    });
  });
});

describe("Clip drag source (I20 seam)", () => {
  it("dragStart on the grip handle writes a clip payload with the track kind", () => {
    const c = useComposition.getState().comp!;
    const clip: VideoClip = {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 2,
      trackOffset: 0,
      transforms: baseTransform,
      filters: baseFilters,
    };
    videoTrack().clips.push(clip);
    useComposition.setState({ comp: c });

    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const dt = fakeDataTransfer();
    fireEvent.dragStart(getByTestId("clip-drag-handle"), { dataTransfer: dt });

    expect(dt.getData(TIMELINE_DND_MIME)).not.toBe("");
    expect(readDragPayload(dt)).toEqual({
      source: "clip",
      clipId: "v1",
      clipKind: "video",
    });
  });

  it("the grip's pointerdown does NOT start the body scrub (no dragState)", () => {
    const c = useComposition.getState().comp!;
    videoTrack().clips.push({
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 2,
      trackOffset: 0,
      transforms: baseTransform,
      filters: baseFilters,
    } as VideoClip);
    useComposition.setState({ comp: c });

    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(getByTestId("clip-drag-handle"), {
      button: 0,
      pointerId: 1,
    });
    // stopPropagation on the grip keeps the Phase 4.B body-scrub pipeline from
    // arming — so no dragState is begun by touching the handle.
    expect(useComposition.getState().dragState).toBeNull();
  });
});

describe("Track drop target — asset payload (I19 seam)", () => {
  it("dropping an asset payload on a matching-kind lane calls addClip with src===asset path", () => {
    const addClip = vi.fn();
    useComposition.setState({ addClip });

    const { getByTestId } = render(
      <Track
        track={videoTrack()}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="Video"
      />,
    );
    const lane = getByTestId("track-lane-video");
    const dt = fakeDataTransfer();
    dt.setData(
      TIMELINE_DND_MIME,
      JSON.stringify({ source: "asset", assetPath: "assets/clips/a.mp4", assetKind: "video" }),
    );
    fireEvent.dragOver(lane, { dataTransfer: dt, clientX: 100 });
    fireEvent.drop(lane, { dataTransfer: dt, clientX: 100 });

    expect(addClip).toHaveBeenCalledTimes(1);
    const [trackId, clip] = addClip.mock.calls[0];
    expect(trackId).toBe(videoTrack().id);
    expect((clip as { src: string }).src).toBe("assets/clips/a.mp4");
  });

  it("an illegal-kind asset payload mutates nothing and marks the indicator rejected", () => {
    const addClip = vi.fn();
    useComposition.setState({ addClip });

    const { getByTestId, queryByTestId } = render(
      <Track
        track={audioTracks()[0]}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="BGM"
      />,
    );
    const lane = getByTestId("track-lane-audio");
    const dt = fakeDataTransfer();
    // video asset onto an AUDIO lane — cross-kind, must reject.
    dt.setData(
      TIMELINE_DND_MIME,
      JSON.stringify({ source: "asset", assetPath: "assets/clips/a.mp4", assetKind: "video" }),
    );
    fireEvent.dragOver(lane, { dataTransfer: dt, clientX: 100 });

    const indicator = queryByTestId("drop-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.getAttribute("data-legal")).toBe("false");
    // The localized reject label is shown (FIX 3).
    expect(queryByTestId("drop-label")!.textContent).toMatch(/can't drop here/i);

    fireEvent.drop(lane, { dataTransfer: dt, clientX: 100 });
    expect(addClip).not.toHaveBeenCalled();
  });
});

describe("Track drop target — clip payload (I20 seam)", () => {
  it("dropping a clip payload on a different same-kind lane calls moveClipToTrack(clipId, targetTrackId)", () => {
    // Seed an audio clip on A1, then drop it onto A2 (same kind, different lane).
    const c = useComposition.getState().comp!;
    const [a1, a2] = audioTracks();
    const audioClip: AudioClip = {
      id: "au1",
      kind: "audio",
      src: "/bgm.mp3",
      in: 0,
      out: 4,
      trackOffset: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      type: "bgm",
    };
    a1.clips.push(audioClip);
    const moveClipToTrack = vi.fn();
    useComposition.setState({ comp: c, moveClipToTrack });

    const { getByTestId } = render(
      <Track
        track={a2}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="VO"
      />,
    );
    const lane = getByTestId("track-lane-audio");
    const dt = fakeDataTransfer();
    dt.setData(
      TIMELINE_DND_MIME,
      JSON.stringify({ source: "clip", clipId: "au1", clipKind: "audio" }),
    );
    fireEvent.dragOver(lane, { dataTransfer: dt, clientX: 80 });
    fireEvent.drop(lane, { dataTransfer: dt, clientX: 80 });

    expect(moveClipToTrack).toHaveBeenCalledTimes(1);
    expect(moveClipToTrack).toHaveBeenCalledWith("au1", a2.id);
  });

  it("a cross-kind clip payload is rejected (no moveClipToTrack)", () => {
    // An audio clip dragged onto the VIDEO lane — cross-kind, must reject.
    const c = useComposition.getState().comp!;
    audioTracks()[0].clips.push({
      id: "au1",
      kind: "audio",
      src: "/bgm.mp3",
      in: 0,
      out: 4,
      trackOffset: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      type: "bgm",
    } as AudioClip);
    const moveClipToTrack = vi.fn();
    useComposition.setState({ comp: c, moveClipToTrack });

    const { getByTestId } = render(
      <Track
        track={videoTrack()}
        pxPerSecond={50}
        totalWidth={400}
        color="var(--accent)"
        label="Video"
      />,
    );
    const lane = getByTestId("track-lane-video");
    const dt = fakeDataTransfer();
    dt.setData(
      TIMELINE_DND_MIME,
      JSON.stringify({ source: "clip", clipId: "au1", clipKind: "audio" }),
    );
    fireEvent.dragOver(lane, { dataTransfer: dt, clientX: 80 });
    expect(getByTestId("drop-indicator").getAttribute("data-legal")).toBe("false");
    fireEvent.drop(lane, { dataTransfer: dt, clientX: 80 });

    expect(moveClipToTrack).not.toHaveBeenCalled();
  });
});
