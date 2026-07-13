import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEmptyComposition } from "../../types";
import { useComposition } from "../../store";
import { Timeline } from "./index";
import {
  makeAudioClip,
  makeTextClip,
} from "../../../../test/composition-fixtures";
import { TIMELINE_DND_MIME } from "./dnd";

function fakeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
}

describe("Timeline toolbar", () => {
  beforeEach(() => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "timeline-icons" }) });
  });

  it("uses shared IconButtons for both zoom controls", () => {
    render(<Timeline />);
    expect(screen.getByRole("button", { name: /zoom out/i })).toHaveAttribute("data-icon-button");
    expect(screen.getByRole("button", { name: /zoom in/i })).toHaveAttribute("data-icon-button");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Timeline beat snap producer", () => {
  it("loads the mounted BGM clip's beats into shared snap candidates", async () => {
    const comp = makeEmptyComposition({ workId: "beat-work" });
    const bgm = makeAudioClip({ id: "bgm", src: "assets/audio/bgm.mp3" });
    comp.tracks.find((track) => track.kind === "audio")!.clips.push(bgm);
    comp.duration = 4;
    useComposition.setState({ comp, beats: [], dragState: null });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, beats: [0.5, 1.25] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Timeline />);

    await waitFor(() => {
      expect(useComposition.getState().beats).toEqual([0.5, 1.25]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/audio/beats",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          workId: "beat-work",
          assetPath: "assets/audio/bgm.mp3",
        }),
      }),
    );
  });
});

describe("Timeline unified snap guide", () => {
  it("carries rounded snap seconds into the next minute", () => {
    const comp = makeEmptyComposition({ workId: "snap-carry" });
    comp.duration = 120;
    useComposition.setState({
      comp,
      dragState: {
        clipId: "",
        originalStart: 0,
        candidateStart: 0,
        preview: new Map(),
        snapTime: 59.999,
        targetTrackId: null,
        guideOnly: true,
      },
    });

    render(<Timeline />);

    expect(screen.getByTestId("snap-line")).toHaveTextContent("1:00.00");
    expect(screen.getByRole("status")).toHaveAccessibleName(/1:00\.00/);
  });

  it("carries rounded snap seconds across later minute boundaries", () => {
    const comp = makeEmptyComposition({ workId: "snap-carry-later" });
    comp.duration = 180;
    useComposition.setState({
      comp,
      dragState: {
        clipId: "",
        originalStart: 0,
        candidateStart: 0,
        preview: new Map(),
        snapTime: 119.999,
        targetTrackId: null,
        guideOnly: true,
      },
    });

    render(<Timeline />);

    expect(screen.getByTestId("snap-line")).toHaveTextContent("2:00.00");
    expect(screen.getByRole("status")).toHaveAccessibleName(/2:00\.00/);
  });

  it("formats hour-scale snap times for the badge and accessible name", () => {
    const comp = makeEmptyComposition({ workId: "snap-hour" });
    comp.duration = 4_000;
    useComposition.setState({
      comp,
      dragState: {
        clipId: "",
        originalStart: 0,
        candidateStart: 0,
        preview: new Map(),
        snapTime: 3_661.235,
        targetTrackId: null,
        guideOnly: true,
      },
    });

    render(<Timeline />);

    expect(screen.getByTestId("snap-line")).toHaveTextContent("1:01:01.24");
    expect(screen.getByRole("status")).toHaveAccessibleName(/1:01:01\.24/);
  });

  it("routes blade hover through the full-height guide without a private blade line", () => {
    const comp = makeEmptyComposition({ workId: "blade-guide" });
    comp.tracks.find((track) => track.kind === "text")!.clips.push(
      makeTextClip({ id: "a", trackOffset: 0, duration: 4 }),
    );
    comp.duration = 4;
    useComposition.setState({
      comp,
      bladeMode: true,
      currentFrame: 0,
      dragState: null,
    });
    render(<Timeline />);

    const blade = screen.getByTestId("blade-overlay");
    fireEvent.pointerMove(blade, { clientX: 4.04 * 60 });

    expect(screen.getByTestId("snap-line")).toHaveTextContent("0:04.00");
    expect(blade.children).toHaveLength(0);
  });

  it("routes native-drop snaps through the full-height guide and clears it on drop", () => {
    const comp = makeEmptyComposition({ workId: "native-drop-guide" });
    comp.duration = 4;
    useComposition.setState({
      comp,
      bladeMode: false,
      currentFrame: 60,
      dragState: null,
    });
    render(<Timeline />);
    const lane = screen.getByTestId("track-lane-video");
    const dataTransfer = fakeDataTransfer();
    dataTransfer.setData(
      TIMELINE_DND_MIME,
      JSON.stringify({
        source: "asset",
        assetPath: "assets/clips/new.mp4",
        assetKind: "video",
      }),
    );

    const clientX = 6 + 2.04 * 60;
    const dragOver = createEvent.dragOver(lane, { dataTransfer });
    Object.defineProperty(dragOver, "clientX", { value: clientX });
    fireEvent(lane, dragOver);

    expect(screen.getByTestId("snap-line")).toHaveTextContent("0:02.00");
    expect(screen.getByTestId("drop-indicator")).not.toBeVisible();

    const drop = createEvent.drop(lane, { dataTransfer });
    Object.defineProperty(drop, "clientX", { value: clientX });
    fireEvent(lane, drop);
    expect(screen.queryByTestId("snap-line")).not.toBeInTheDocument();
  });
});
