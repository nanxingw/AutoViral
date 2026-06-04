import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipTrackSelect } from "./ClipTrackSelect";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import { useLocaleStore } from "@/i18n/store";
import type { AudioClip, VideoClip } from "../../types";

// #88 — the Inspector track-select is the reliable cross-lane move path.

function audioClip(id: string): AudioClip {
  return {
    id,
    kind: "audio",
    src: "a.mp3",
    in: 0,
    out: 3,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  };
}
function videoClip(id: string): VideoClip {
  return {
    id,
    kind: "video",
    src: "v.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
});
afterEach(() => {
  useLocaleStore.getState().setLocale("en");
});

describe("<ClipTrackSelect /> (#88)", () => {
  it("offers the same-kind lanes and moving the select reassigns the clip", () => {
    const audioLanes = useComposition
      .getState()
      .comp!.tracks.filter((t) => t.kind === "audio");
    const [a1, a2] = audioLanes;
    useComposition.getState().addClip(a1.id, audioClip("c1"));
    useComposition.setState({ selection: "c1" });

    render(<ClipTrackSelect />);
    const select = screen.getByRole("combobox", { name: /track/i }) as HTMLSelectElement;
    // Two audio lanes → two options, current = a1.
    expect(select.value).toBe(a1.id);
    expect(select.options).toHaveLength(2);

    fireEvent.change(select, { target: { value: a2.id } });
    const tracks = useComposition.getState().comp!.tracks;
    expect(tracks.find((t) => t.id === a1.id)!.clips).toHaveLength(0);
    expect(tracks.find((t) => t.id === a2.id)!.clips).toHaveLength(1);
  });

  it("renders nothing when the clip's kind has only one lane", () => {
    // Default lane set has a single VIDEO lane → nowhere to move a video clip.
    const v1 = useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
    useComposition.getState().addClip(v1.id, videoClip("v1"));
    useComposition.setState({ selection: "v1" });
    const { container } = render(<ClipTrackSelect />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no clip is selected", () => {
    useComposition.setState({ selection: null });
    const { container } = render(<ClipTrackSelect />);
    expect(container).toBeEmptyDOMElement();
  });
});
