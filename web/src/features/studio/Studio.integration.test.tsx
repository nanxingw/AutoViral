import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Studio from "@/pages/Studio";
import { useComposition } from "./store";
import { makeEmptyComposition, type VideoClip } from "./types";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div
      data-testid="player"
      data-fps={props.fps}
      data-comp-w={props.compositionWidth}
    />
  ),
}));

vi.mock("./services/composition", () => ({
  loadComposition: vi.fn(async () => null),
  saveComposition: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

beforeEach(() => {
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
  });
});

function mount() {
  return render(
    <MemoryRouter initialEntries={["/studio/w1"]}>
      <Routes>
        <Route path="/studio/:workId" element={<Studio />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Studio integration", () => {
  it("mounts with empty composition and renders Player", async () => {
    const { findByTestId } = mount();
    const player = await findByTestId("player");
    expect(player.getAttribute("data-fps")).toBe("30");
  });

  it("adding a clip surfaces it on the timeline", async () => {
    mount();
    // Wait a tick for the loader effect to populate the store.
    await new Promise((r) => setTimeout(r, 10));
    const c = useComposition.getState().comp ?? makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    const v: VideoClip = {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 4,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };
    useComposition.getState().addClip("video-0", v);
    const tracks = useComposition.getState().comp!.tracks;
    expect(tracks[0].clips).toHaveLength(1);
  });

  it("brightness slider in Tweaks writes through to the store", async () => {
    const { findByTestId } = mount();
    await findByTestId("player");
    const c = makeEmptyComposition({ workId: "w1" });
    const v: VideoClip = {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 4,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };
    c.tracks[0].clips.push(v);
    useComposition.setState({ comp: c, selection: "v1" });
    const slider = (await findByTestId(
      "layer-brightness",
    )) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.5" } });
    const after = useComposition.getState().comp!.tracks[0].clips[0];
    if (after.kind !== "video") throw new Error("expected video");
    expect(after.filters.brightness).toBeCloseTo(0.5, 5);
  });
});
