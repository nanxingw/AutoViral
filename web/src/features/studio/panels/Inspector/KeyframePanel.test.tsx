import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyframePanel } from "./KeyframePanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type {
  AudioClip,
  Composition,
  Keyframe,
  OverlayClip,
  TextClip,
  VideoClip,
} from "../../types";

// Phase 8.2.D — KeyframePanel tests. v1 is a table-style editor (D6) that
// mounts in InspectorTab below VariantSwitcher (D7). Hidden for TextClip
// selection (D8). Property options vary by clip kind:
//   video   → scale, x, y, rotation
//   overlay → scale, x, y, rotation, opacity
//   audio   → volume only (D5)

function makeCompWithVideoClip(
  id: string,
  overrides: Partial<VideoClip> = {},
): Composition {
  const c = makeEmptyComposition({ workId: "w-kp" });
  const clip: VideoClip = {
    id,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks[0].clips as VideoClip[]).push(clip);
  return c;
}

function makeCompWithAudioClip(
  id: string,
  overrides: Partial<AudioClip> = {},
): Composition {
  const c = makeEmptyComposition({ workId: "w-kp" });
  const clip: AudioClip = {
    id,
    kind: "audio",
    src: "/a.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...overrides,
  };
  (c.tracks[1].clips as AudioClip[]).push(clip);
  return c;
}

function makeCompWithOverlayClip(
  id: string,
  overrides: Partial<OverlayClip> = {},
): Composition {
  const c = makeEmptyComposition({ workId: "w-kp" });
  const clip: OverlayClip = {
    id,
    kind: "overlay",
    src: "/o.png",
    trackOffset: 0,
    duration: 2,
    position: { xPct: 50, yPct: 50, wPct: 20, hPct: 20 },
    opacity: 1,
    ...overrides,
  };
  (c.tracks[3].clips as OverlayClip[]).push(clip);
  return c;
}

function makeCompWithTextClip(id: string): Composition {
  const c = makeEmptyComposition({ workId: "w-kp" });
  const clip: TextClip = {
    id,
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 2,
    style: {
      font: "Inter",
      size: 64,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#fff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  };
  (c.tracks[2].clips as TextClip[]).push(clip);
  return c;
}

describe("KeyframePanel", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
  });

  it("renders empty state when no clip is selected", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w" }), selection: null });
    render(<KeyframePanel />);
    expect(screen.getByText(/select a clip/i)).toBeInTheDocument();
  });

  it("renders empty state when selected clip is a TextClip (D8)", () => {
    const comp = makeCompWithTextClip("text-1");
    useComposition.setState({ comp, selection: "text-1" });
    render(<KeyframePanel />);
    expect(screen.getByText(/text clips use the animation enum/i)).toBeInTheDocument();
    // No keyframe rows or Add button rendered.
    expect(screen.queryByRole("button", { name: /add keyframe/i })).not.toBeInTheDocument();
  });

  it("renders rows grouped by property and sorted by time for the selected clip's keyframes", () => {
    const keyframes: Keyframe[] = [
      { property: "scale", time: 2, value: 2, easing: "linear" },
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "x", time: 1, value: 50, easing: "linear" },
    ];
    const comp = makeCompWithVideoClip("clip-1", { keyframes });
    useComposition.setState({ comp, selection: "clip-1" });
    render(<KeyframePanel />);
    const rows = screen.getAllByTestId("keyframe-row");
    expect(rows).toHaveLength(3);
    // Scale group displays first (time-sorted within group). The first row is
    // scale@0; second is scale@2; third is x@1.
    expect(rows[0]).toHaveTextContent("scale");
    expect(rows[1]).toHaveTextContent("scale");
    expect(rows[2]).toHaveTextContent("x");
  });

  it("clicking 'Add keyframe' opens the form; submitting calls store.addKeyframe with the right args", async () => {
    const user = userEvent.setup();
    const comp = makeCompWithVideoClip("clip-1");
    useComposition.setState({ comp, selection: "clip-1", currentFrame: 0 });
    const spy = vi.spyOn(useComposition.getState(), "addKeyframe");
    render(<KeyframePanel />);
    await user.click(screen.getByRole("button", { name: /add keyframe/i }));
    // Form shows defaults — submit immediately.
    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(spy).toHaveBeenCalledWith(
      "clip-1",
      expect.objectContaining({
        property: "scale",
        easing: "linear",
      }),
    );
  });

  it("clicking the trash icon on a row calls store.removeKeyframe with the original index", async () => {
    const user = userEvent.setup();
    // Original index 0 = time=2; original index 1 = time=0 (sorts FIRST in display).
    const keyframes: Keyframe[] = [
      { property: "scale", time: 2, value: 2, easing: "linear" },
      { property: "scale", time: 0, value: 1, easing: "linear" },
    ];
    const comp = makeCompWithVideoClip("clip-1", { keyframes });
    useComposition.setState({ comp, selection: "clip-1" });
    const spy = vi.spyOn(useComposition.getState(), "removeKeyframe");
    render(<KeyframePanel />);
    const trashButtons = screen.getAllByRole("button", { name: /delete keyframe/i });
    await user.click(trashButtons[0]);
    // Display row 0 = time=0 → original index 1.
    expect(spy).toHaveBeenCalledWith("clip-1", 1);
  });

  it("editing the value input calls store.updateKeyframe with the patch and the original index", async () => {
    const user = userEvent.setup();
    const keyframes: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
    ];
    const comp = makeCompWithVideoClip("clip-1", { keyframes });
    useComposition.setState({ comp, selection: "clip-1" });
    const spy = vi.spyOn(useComposition.getState(), "updateKeyframe");
    render(<KeyframePanel />);
    const valueInputs = screen.getAllByLabelText(/value/i);
    const valueInput = valueInputs[0];
    await user.clear(valueInput);
    await user.type(valueInput, "1.5");
    await user.tab();
    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[0]).toBe("clip-1");
    expect(lastCall[1]).toBe(0);
    expect((lastCall[2] as Partial<Keyframe>).value).toBeCloseTo(1.5, 3);
  });

  it("AudioClip selection only exposes 'volume' as a property option (D5)", async () => {
    const user = userEvent.setup();
    const comp = makeCompWithAudioClip("audio-1");
    useComposition.setState({ comp, selection: "audio-1" });
    render(<KeyframePanel />);
    await user.click(screen.getByRole("button", { name: /add keyframe/i }));
    const propertySelect = screen.getByLabelText(/property/i) as HTMLSelectElement;
    const options = Array.from(propertySelect.options).map((o) => o.value);
    expect(options).toEqual(["volume"]);
  });

  it("OverlayClip selection exposes scale/x/y/rotation/opacity (no volume)", async () => {
    const user = userEvent.setup();
    const comp = makeCompWithOverlayClip("ov-1");
    useComposition.setState({ comp, selection: "ov-1" });
    render(<KeyframePanel />);
    await user.click(screen.getByRole("button", { name: /add keyframe/i }));
    const propertySelect = screen.getByLabelText(/property/i) as HTMLSelectElement;
    const options = Array.from(propertySelect.options).map((o) => o.value);
    expect(options).toEqual(["scale", "x", "y", "rotation", "opacity"]);
  });

  // Phase 8.3.D — VideoClip gains "speed" in the property dropdown; AudioClip
  // and OverlayClip explicitly do NOT (D1 — speed is VideoClip-only in v1).
  it("VideoClip selection exposes 'speed' as the 5th property option (D1)", async () => {
    const user = userEvent.setup();
    const comp = makeCompWithVideoClip("v-1");
    useComposition.setState({ comp, selection: "v-1" });
    render(<KeyframePanel />);
    await user.click(screen.getByRole("button", { name: /add keyframe/i }));
    const propertySelect = screen.getByLabelText(/property/i) as HTMLSelectElement;
    const options = Array.from(propertySelect.options).map((o) => o.value);
    expect(options).toEqual(["scale", "x", "y", "rotation", "speed"]);
  });
});
