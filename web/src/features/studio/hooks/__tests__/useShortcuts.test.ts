// Phase 4.J — keyboard shortcut wiring tests.
//
// Pneuma fidelity: keydown listener idiom + input-element guard ported
// from .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useTimelineShortcuts.ts:12-18,28-30,111-112.
// User-overridden bindings (B blade / Cmd+B split) replace pneuma's
// `S`-for-split per USER DECISION (master plan §4.2.J adaptation).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShortcuts } from "../useShortcuts";
import { useComposition } from "../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

function key(opts: Partial<KeyboardEventInit & { key: string }>) {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  const b = makeVideoClip({ id: "b", trackOffset: 4, in: 0, out: 2 });
  const comp = makeCompositionWithClips([a, b]);
  comp.fps = 30;
  useComposition.setState({
    comp,
    selection: "b",
    currentFrame: 60, // 2s
    isPlaying: false,
    bladeMode: false,
    dragState: null,
  });
});

describe("useShortcuts (Phase 4.J)", () => {
  it("B toggles bladeMode", () => {
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "b" }));
    expect(useComposition.getState().bladeMode).toBe(true);
    window.dispatchEvent(key({ key: "b" }));
    expect(useComposition.getState().bladeMode).toBe(false);
  });

  it("Cmd+B splits the clip under the playhead on the selected track", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "split-id" as `${string}-${string}-${string}-${string}-${string}`,
    );
    renderHook(() => useShortcuts(null));
    // selection = "b"; b is at trackOffset 4..6; playhead at 2s — NOT in b → no-op (D4)
    window.dispatchEvent(key({ key: "b", metaKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
    // Move playhead to 5s (inside b)
    useComposition.setState({ currentFrame: 150 });
    window.dispatchEvent(key({ key: "b", metaKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(3);
    vi.restoreAllMocks();
  });

  it("Shift+Backspace ripple-deletes the selected clip (D6 — checked before plain Backspace)", () => {
    renderHook(() => useShortcuts(null));
    // selection = "b". Ripple delete b → clips length 1, a stays at 0..4.
    window.dispatchEvent(key({ key: "Backspace", shiftKey: true }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe("a");
  });

  it("plain Backspace still removes without ripple (D6 — preserved)", () => {
    renderHook(() => useShortcuts(null));
    // selection = "b". Plain backspace removes b but a stays where it was (no ripple).
    window.dispatchEvent(key({ key: "Backspace" }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe("a");
    expect(clips[0].trackOffset).toBeCloseTo(0);
  });

  it("Cmd+Shift+G collapses gaps on the selected clip's track", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 1 }),
        makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 }),
      ]),
      selection: "a",
    });
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "g", metaKey: true, shiftKey: true }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 1]);
  });

  it("ignores B keypress when typing inside an <input> (input-element guard)", () => {
    renderHook(() => useShortcuts(null));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(key({ key: "b" }));
    expect(useComposition.getState().bladeMode).toBe(false);
    document.body.removeChild(input);
  });

  it("ignores Backspace inside a <textarea> so editing copy doesn't delete clips", () => {
    renderHook(() => useShortcuts(null));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(key({ key: "Backspace" }));
    // selection = "b" still present, clip count unchanged.
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
    document.body.removeChild(ta);
  });

  it("Cmd+B at the exact boundary of a clip is a no-op (boundary epsilon)", () => {
    // playhead at 4s = exactly the start of b; should not split.
    useComposition.setState({ currentFrame: 120 }); // 4s
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "b", metaKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
  });

  it("Shift+Backspace with no selection is a no-op", () => {
    useComposition.setState({ selection: null });
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "Backspace", shiftKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
  });
});
