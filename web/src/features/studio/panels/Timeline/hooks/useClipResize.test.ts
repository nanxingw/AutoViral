import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { useClipResize } from "./useClipResize";
import { useComposition } from "../../../store";
import {
  makeAudioClip,
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../../test/composition-fixtures";
import { Filmstrip } from "../Filmstrip";
import { WaveformBars } from "../WaveformBars";
import { __resetFrameCacheForTests } from "./useFrameExtractor";
import { _resetWaveformCacheForTests } from "../../../hooks/useWaveform";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
  const comp = makeCompositionWithClips([a, b]);
  comp.assets.push({
    id: "asset-x",
    uri: "/x.mp4",
    kind: "video",
    metadata: { duration: 10 },
    status: "ready",
  });
  useComposition.setState({
    comp,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
  });
});

describe("useClipResize", () => {
  it("right-edge drag updates clip.out via the store", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // a.end currently at 2 → +50px → +1s → newTime = 3s, out = in + (3 - 0) = 3
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(a.out).toBeCloseTo(3);
  });

  it("snaps the resized edge to a neighbouring clip's start (D1 0.06s)", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // a.end=2; b.start=5. Drag +148px → 2 + 148/50 = 4.96 → within 0.06s of 5 → snap to 5.
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(148);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    // out = in + (5 - trackOffset) = 0 + 5 - 0 = 5
    expect(a.out).toBeCloseTo(5);
  });

  it("publishes a snapped trim to the unified guide until resize ends", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );

    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(148);
    });
    expect(useComposition.getState().dragState?.snapTime).toBeCloseTo(5);

    act(() => result.current.endResize());
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("left-edge drag updates trackOffset + in", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 1, in: 1, out: 4 }),
      ]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor = trackOffset = 1; +50px → +1s → newTime = 2 → trackOffset 2, in 2
    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });
    const clip = useComposition.getState().comp!.tracks[0].clips[0] as {
      trackOffset: number;
      in: number;
    };
    expect(clip.trackOffset).toBeCloseTo(2);
    expect(clip.in).toBeCloseTo(2);
  });

  it("returns isResizing true between begin and end", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    expect(result.current.isResizing).toBe(false);
    act(() => result.current.beginResize("right", 0));
    expect(result.current.isResizing).toBe(true);
    act(() => result.current.endResize());
    expect(result.current.isResizing).toBe(false);
  });

  it("keeps the legacy single-selection trim path when multi-selection state is stale", () => {
    useComposition.setState({
      selection: "b",
      timelineSelection: {
        ids: ["a", "b"],
        primaryId: "a",
        anchorId: "a",
      },
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "b", pxPerSecond: 50 }),
    );

    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });

    const b = useComposition
      .getState()
      .comp!.tracks[0].clips.find((clip) => clip.id === "b")! as {
      out: number;
    };
    expect(b.out).toBeCloseTo(3);
  });

  it("allows trim only on the primary clip in a multi-selection", () => {
    useComposition.getState().setTimelineSelection({
      ids: ["a", "b"],
      primaryId: "a",
      anchorId: "a",
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "b", pxPerSecond: 50 }),
    );

    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });

    const b = useComposition
      .getState()
      .comp!.tracks[0].clips.find((clip) => clip.id === "b")! as {
      out: number;
    };
    expect(b.out).toBeCloseTo(2);
  });

  it("renders Filmstrip and Waveform from the updated source time after a left trim", async () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 2, in: 1, out: 4 }),
      ]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );

    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(50);
      result.current.endResize();
    });

    const trimmedVideo = useComposition.getState().comp!.tracks[0]
      .clips[0] as ReturnType<typeof makeVideoClip>;
    __resetFrameCacheForTests();
    const seekSpy = vi.fn();
    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "currentTime",
    );
    const currentTimes = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      set(this: HTMLMediaElement, time: number) {
        currentTimes.set(this, time);
        seekSpy(time);
        queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
      },
      get(this: HTMLMediaElement) {
        return currentTimes.get(this) ?? 0;
      },
    });
    try {
      const filmstrip = render(
        createElement(Filmstrip, {
          clip: trimmedVideo,
          pxPerSecond: 50,
          height: 48,
        }),
      );
      await waitFor(() => expect(seekSpy).toHaveBeenCalled());
      expect(
        Math.min(...seekSpy.mock.calls.map(([time]) => time)),
      ).toBeCloseTo(2);
      filmstrip.unmount();
    } finally {
      if (currentTimeDescriptor) {
        Object.defineProperty(
          HTMLMediaElement.prototype,
          "currentTime",
          currentTimeDescriptor,
        );
      }
    }

    const audio = makeAudioClip({
      id: "audio",
      trackOffset: 2,
      in: 0.1,
      out: 0.8,
    });
    useComposition.setState({ comp: makeCompositionWithClips([audio]) });
    const audioResize = renderHook(() =>
      useClipResize({ clipId: "audio", pxPerSecond: 50 }),
    );
    act(() => {
      audioResize.result.current.beginResize("left", 0);
      audioResize.result.current.dragResize(5);
      audioResize.result.current.endResize();
    });
    const trimmedAudio = useComposition.getState().comp!.tracks[0]
      .clips[0] as ReturnType<typeof makeAudioClip>;
    _resetWaveformCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    try {
      const waveform = render(
        createElement(WaveformBars, {
          clip: trimmedAudio,
          pxPerSecond: 50,
          height: 48,
        }),
      );
      await waitFor(() => {
        const renderedWaveform = waveform.container.querySelector(
          '[aria-label="waveform"]',
        );
        expect(renderedWaveform).not.toBeNull();
        expect(
          Number(renderedWaveform!.getAttribute("data-source-offset")),
        ).toBeCloseTo(0.2);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("right-edge drag is capped by next clip's start (D2 via store)", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor=2, drag +1000px → newTime=22; b.start=5 caps it.
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(1000);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(a.out).toBeCloseTo(5);
  });

  it("left-edge drag clamps to 0 if dragged past the timeline start", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 2, in: 2, out: 5 }),
      ]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // anchor=2, drag -1000px → newTime=-18 → store clamps to 0.
    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(-1000);
      result.current.endResize();
    });
    const clip = useComposition.getState().comp!.tracks[0].clips[0] as {
      trackOffset: number;
      in: number;
    };
    expect(clip.trackOffset).toBeCloseTo(0);
    // delta = 0 - 2 = -2 → in becomes 2 + (-2) = 0
    expect(clip.in).toBeCloseTo(0);
  });

  it("cancelResize reverts the clip to its pre-drag state", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(50); // out becomes 3
    });
    const mid = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(mid.out).toBeCloseTo(3);
    act(() => result.current.cancelResize());
    const after = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as { out: number };
    expect(after.out).toBeCloseTo(2);
    expect(result.current.isResizing).toBe(false);
  });

  it("enforces a 0.1s minimum visible duration", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(-1000);
      result.current.endResize();
    });
    const a = useComposition
      .getState()
      .comp!.tracks[0].clips.find((c) => c.id === "a")! as {
      in: number;
      out: number;
    };
    expect(a.out - a.in).toBeCloseTo(0.1);
  });

  it("caps a right trim at the source asset duration", () => {
    const clip = makeVideoClip({
      id: "source-bounded",
      src: "assets/clips/source.mp4",
      trackOffset: 1,
      in: 0.5,
      out: 2,
    });
    const comp = makeCompositionWithClips([clip]);
    comp.assets.push({
      id: "asset-source",
      uri: "assets/clips/source.mp4",
      kind: "video",
      metadata: { duration: 3 },
      status: "ready",
    });
    useComposition.setState({ comp });

    const { result } = renderHook(() =>
      useClipResize({ clipId: "source-bounded", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(1000);
      result.current.endResize();
    });
    const after = useComposition.getState().comp!.tracks[0].clips[0] as {
      out: number;
    };
    expect(after.out).toBeCloseTo(3);
  });

  it.each(["missing asset", "missing duration metadata"])(
    "uses the clip source window when the registry has %s",
    (registryCase) => {
      const clip = makeVideoClip({
        id: "source-without-asset-metadata",
        src: "assets/clips/unregistered.mp4",
        trackOffset: 4,
        in: 1,
        out: 3,
      });
      const comp = makeCompositionWithClips([clip]);
      if (registryCase === "missing duration metadata") {
        comp.assets.push({
          id: "durationless-source",
          uri: "assets/clips/unregistered.mp4",
          kind: "video",
          metadata: {},
          status: "ready",
        });
      }
      useComposition.setState({ comp });

      const { result } = renderHook(() =>
        useClipResize({
          clipId: "source-without-asset-metadata",
          pxPerSecond: 50,
        }),
      );
      act(() => {
        result.current.beginResize("right", 0);
        result.current.dragResize(1000);
      });

      const after = useComposition.getState().comp!.tracks[0].clips[0] as {
        out: number;
      };
      expect(after.out).toBeCloseTo(3);
      expect(result.current.sourceGhost).toEqual({ startSec: 3, endSec: 6 });
    },
  );

  it("exposes the full source ghost bounds only while trimming", () => {
    const clip = makeVideoClip({
      id: "ghost",
      src: "assets/clips/source.mp4",
      trackOffset: 4,
      in: 1,
      out: 3,
    });
    const comp = makeCompositionWithClips([clip]);
    comp.assets.push({
      id: "asset-source",
      uri: "assets/clips/source.mp4",
      kind: "video",
      metadata: { duration: 8 },
      status: "ready",
    });
    useComposition.setState({ comp });

    const { result } = renderHook(() =>
      useClipResize({ clipId: "ghost", pxPerSecond: 50 }),
    );
    expect(result.current.sourceGhost).toBeNull();
    act(() => result.current.beginResize("left", 0));
    expect(result.current.sourceGhost).toEqual({ startSec: 3, endSec: 11 });
    act(() => result.current.endResize());
    expect(result.current.sourceGhost).toBeNull();
  });
});
