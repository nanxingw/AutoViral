// A6 (PRD-0010) — AudioAssetRow compact-row tests.
//
// The AUDIO group renders ~52px horizontal rows: play/pause + mini waveform
// (shared PeaksSvg fed by the same useWaveform peaks cache) + mono duration +
// filename, keeping the existing ＋/delete/drag affordances. We mock the two
// hooks so the row's own wiring is isolated (peaks fixture drives the waveform
// + durationSec drives the mono duration label).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioAssetRow } from "./AudioAssetRow";
import {
  readDragPayload,
  TIMELINE_DND_MIME,
} from "../Timeline/dnd";
import type { AssetItem } from "@/queries/assets";

const auditionToggle = vi.fn();
let auditionPlaying = false;

vi.mock("../../hooks/useAudioAudition", () => ({
  useAudioAudition: () => ({ playing: auditionPlaying, toggle: auditionToggle }),
}));

vi.mock("../../hooks/useWaveform", () => ({
  useWaveform: () => ({
    peaks: new Float32Array([0.2, 0.6, 1.0, 0.3, 0.5]),
    sourceDuration: 12.5,
    loading: false,
    error: null,
  }),
  _resetWaveformCacheForTests: () => {},
}));

const AUDIO: AssetItem = {
  path: "assets/audio/bed.mp3",
  url: "/api/works/w1/assets/audio/bed.mp3",
  kind: "audio",
  ext: "mp3",
  name: "bed.mp3",
};

function fakeDT() {
  const store = new Map<string, string>();
  return {
    setData: (t: string, d: string) => void store.set(t, d),
    getData: (t: string) => store.get(t) ?? "",
    effectAllowed: "",
  } as unknown as DataTransfer;
}

describe("AudioAssetRow", () => {
  it("renders the shared mini waveform from the peaks cache", () => {
    const { container } = render(
      <AudioAssetRow item={AUDIO} index={0} onOpen={() => {}} />,
    );
    expect(
      container.querySelector('svg[aria-label="waveform"]'),
    ).not.toBeNull();
    // 5 peaks in the fixture → 5 bars.
    expect(container.querySelectorAll("rect").length).toBe(5);
  });

  it("shows the mono duration derived from the source durationSec", () => {
    render(<AudioAssetRow item={AUDIO} index={0} onOpen={() => {}} />);
    // 12.5s → 0:12
    expect(screen.getByText("0:12")).toBeInTheDocument();
  });

  it("shows the filename", () => {
    render(<AudioAssetRow item={AUDIO} index={0} onOpen={() => {}} />);
    expect(screen.getByText("bed.mp3")).toBeInTheDocument();
  });

  it("play/pause button drives the audition toggle (not the preview)", () => {
    const onOpen = vi.fn();
    render(<AudioAssetRow item={AUDIO} index={0} onOpen={onOpen} />);
    const play = screen.getByRole("button", { name: /play preview/i });
    fireEvent.click(play);
    expect(auditionToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled(); // stopPropagation
  });

  it("keeps the ＋ add-to-timeline affordance", () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    render(
      <AudioAssetRow
        item={AUDIO}
        index={0}
        onOpen={onOpen}
        onAdd={onAdd}
        addLabel="Add to timeline"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add to timeline/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the delete affordance", () => {
    const onDelete = vi.fn();
    render(
      <AudioAssetRow
        item={AUDIO}
        index={0}
        onOpen={() => {}}
        onDelete={onDelete}
        deleteLabel="Delete asset"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete asset/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("writes an unchanged asset drag payload (drag regression)", () => {
    const { container } = render(
      <AudioAssetRow
        item={AUDIO}
        index={0}
        onOpen={() => {}}
        onAdd={() => {}}
      />,
    );
    const row = container.querySelector('[draggable="true"]') as HTMLElement;
    expect(row).not.toBeNull();
    const dt = fakeDT();
    fireEvent.dragStart(row, { dataTransfer: dt });
    expect(dt.getData(TIMELINE_DND_MIME)).toContain("audio");
    expect(readDragPayload(dt)).toEqual({
      source: "asset",
      assetPath: "assets/audio/bed.mp3",
      assetKind: "audio",
    });
  });
});
