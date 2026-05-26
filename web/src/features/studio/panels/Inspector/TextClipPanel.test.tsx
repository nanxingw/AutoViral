import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextClipPanel } from "./TextClipPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Composition, TextClip } from "../../types";

// #58 — edit-site clamp on TextClipPanel's number inputs. HTML min/max
// only constrain spinner + :invalid styling; typed values fall straight
// through to updateClip unless we clamp in onChange. Sibling regression
// net for the StaticPropsPanel pattern (#56) and #40 (keyframe TIME).

function compWithTextClip(id: string, overrides: Partial<TextClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-tc" });
  const clip: TextClip = {
    id,
    kind: "text",
    text: "hello",
    trackOffset: 0,
    duration: 2.3,
    style: {
      font: "Inter",
      size: 56,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#ffffff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 88 },
    ...overrides,
  };
  // Text track is the 4th in the default empty composition (V1 / A1 / A2 / CC1).
  const textTrack = c.tracks.find((t) => t.kind === "text")!;
  (textTrack.clips as TextClip[]).push(clip);
  return c;
}

function liveTextClip(id: string): TextClip {
  return useComposition.getState().comp!.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === id)! as TextClip;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("<TextClipPanel /> — number input clamping (#58)", () => {
  it("Y% typed value of 999 is clamped to 100", () => {
    useComposition.setState({
      comp: compWithTextClip("t1"),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const yInput = screen.getByRole("spinbutton", { name: /^y%$/i });
    fireEvent.change(yInput, { target: { value: "999" } });
    expect(liveTextClip("t1").position!.yPct).toBe(100);
  });

  it("Y% typed value of -50 is clamped to 0", () => {
    useComposition.setState({
      comp: compWithTextClip("t1"),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const yInput = screen.getByRole("spinbutton", { name: /^y%$/i });
    fireEvent.change(yInput, { target: { value: "-50" } });
    expect(liveTextClip("t1").position!.yPct).toBe(0);
  });

  it("duration typed value of 0 is clamped to 0.1 (no zero-length subtitles)", () => {
    useComposition.setState({
      comp: compWithTextClip("t1", { duration: 2.3 }),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const dur = screen.getByRole("spinbutton", { name: /duration/i });
    fireEvent.change(dur, { target: { value: "0" } });
    expect(liveTextClip("t1").duration).toBe(0.1);
  });

  it("font-size typed value of 9999 is clamped to 200", () => {
    useComposition.setState({
      comp: compWithTextClip("t1"),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const size = screen.getByRole("spinbutton", { name: /size/i });
    fireEvent.change(size, { target: { value: "9999" } });
    expect(liveTextClip("t1").style!.size).toBe(200);
  });

  it("in-bounds values pass through unchanged (clamp is no-op when within range)", () => {
    useComposition.setState({
      comp: compWithTextClip("t1"),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const yInput = screen.getByRole("spinbutton", { name: /^y%$/i });
    fireEvent.change(yInput, { target: { value: "42" } });
    expect(liveTextClip("t1").position!.yPct).toBe(42);
  });

  it("clamped Y% does not wipe sibling fields on the position object", () => {
    useComposition.setState({
      comp: compWithTextClip("t1", {
        position: { anchor: "top", xPct: 25, yPct: 88 },
      }),
      selection: "t1",
    });
    render(<TextClipPanel />);
    const yInput = screen.getByRole("spinbutton", { name: /^y%$/i });
    fireEvent.change(yInput, { target: { value: "999" } });
    const live = liveTextClip("t1");
    // The clamp lives inside NumberField; the spread `{ ...position, yPct }`
    // in TextClipPanel must still survive — anchor + xPct intact.
    expect(live.position).toEqual({ anchor: "top", xPct: 25, yPct: 100 });
  });
});
