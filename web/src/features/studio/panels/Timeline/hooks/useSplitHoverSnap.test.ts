import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSplitHoverSnap } from "./useSplitHoverSnap";
import { useComposition } from "../../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../../test/composition-fixtures";

describe("useSplitHoverSnap", () => {
  it("returns null snapTime when not hovering", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]) });
    const { result } = renderHook(() => useSplitHoverSnap());
    expect(result.current.snapTime).toBeNull();
  });

  it("snaps the hover position to the nearest clip edge within threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    const b = makeVideoClip({ id: "b", trackOffset: 4, in: 0, out: 2 });
    useComposition.setState({ comp: makeCompositionWithClips([a, b]) });
    const { result } = renderHook(() => useSplitHoverSnap());
    act(() => {
      result.current.setHoverTime(4.04);
    });
    expect(result.current.snapTime).toBeCloseTo(4);
    expect(result.current.snappedToEdge).toBe(true);
  });

  it("returns the raw time outside threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]) });
    const { result } = renderHook(() => useSplitHoverSnap());
    act(() => {
      result.current.setHoverTime(2.5);
    });
    expect(result.current.snapTime).toBeCloseTo(2.5);
    expect(result.current.snappedToEdge).toBe(false);
  });

  it("clears the hover state when setHoverTime(null) is called", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]) });
    const { result } = renderHook(() => useSplitHoverSnap());
    act(() => {
      result.current.setHoverTime(2.5);
    });
    expect(result.current.snapTime).toBeCloseTo(2.5);
    act(() => {
      result.current.setHoverTime(null);
    });
    expect(result.current.snapTime).toBeNull();
  });
});
