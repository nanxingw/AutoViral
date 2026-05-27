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

// #86 — the rest of the style surface that TextTrackRenderer + the shared
// TextClipSchema already support but the panel never exposed: color / font /
// weight / italic / tracking / stroke / anchor / animation. These tests assert
// each control writes the right schema field AND that style.* edits preserve
// the sibling style fields (updateClip does a shallow Object.assign).
describe("<TextClipPanel /> — full style surface (#86)", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: compWithTextClip("t1"),
      selection: "t1",
    });
  });

  it("color picker writes style.color", () => {
    render(<TextClipPanel />);
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#ff0000" },
    });
    expect(liveTextClip("t1").style!.color).toBe("#ff0000");
  });

  it("font select writes style.font", () => {
    render(<TextClipPanel />);
    fireEvent.change(screen.getByLabelText("Font"), {
      target: { value: "Instrument Serif" },
    });
    expect(liveTextClip("t1").style!.font).toBe("Instrument Serif");
  });

  it("weight select writes a numeric style.weight", () => {
    render(<TextClipPanel />);
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "900" },
    });
    const w = liveTextClip("t1").style!.weight;
    expect(w).toBe(900);
    expect(typeof w).toBe("number");
  });

  it("italic checkbox toggles style.italic", () => {
    render(<TextClipPanel />);
    fireEvent.click(screen.getByLabelText("Italic"));
    expect(liveTextClip("t1").style!.italic).toBe(true);
  });

  it("tracking input writes style.tracking (negative allowed down to -20)", () => {
    render(<TextClipPanel />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /tracking/i }), {
      target: { value: "-5" },
    });
    expect(liveTextClip("t1").style!.tracking).toBe(-5);
  });

  it("anchor select writes position.anchor without losing xPct/yPct", () => {
    render(<TextClipPanel />);
    fireEvent.change(screen.getByLabelText("Anchor"), {
      target: { value: "top" },
    });
    const pos = liveTextClip("t1").position!;
    expect(pos.anchor).toBe("top");
    expect(pos.xPct).toBe(50);
    expect(pos.yPct).toBe(88);
  });

  it("animation select sets the enum, and 'None' clears it back to undefined", () => {
    render(<TextClipPanel />);
    const anim = screen.getByLabelText("Animation");
    fireEvent.change(anim, { target: { value: "typewriter" } });
    expect(liveTextClip("t1").animation).toBe("typewriter");
    fireEvent.change(anim, { target: { value: "none" } });
    expect(liveTextClip("t1").animation).toBeUndefined();
  });

  it("stroke checkbox enables a default stroke and disabling clears it", () => {
    render(<TextClipPanel />);
    const strokeToggle = screen.getByLabelText("Stroke");
    fireEvent.click(strokeToggle);
    expect(liveTextClip("t1").style!.stroke).toEqual({
      width: 4,
      color: "#000000",
    });
    // Width sub-control only appears once stroke is on.
    fireEvent.change(screen.getByRole("spinbutton", { name: /stroke width/i }), {
      target: { value: "8" },
    });
    expect(liveTextClip("t1").style!.stroke).toEqual({
      width: 8,
      color: "#000000",
    });
    fireEvent.click(strokeToggle);
    expect(liveTextClip("t1").style!.stroke).toBeUndefined();
  });

  it("a style edit preserves the sibling style fields (shallow-merge guard)", () => {
    render(<TextClipPanel />);
    // Seed clip has size:56 weight:700; changing color must not drop them.
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#00ff00" },
    });
    const s = liveTextClip("t1").style!;
    expect(s.color).toBe("#00ff00");
    expect(s.size).toBe(56);
    expect(s.weight).toBe(700);
  });
});
