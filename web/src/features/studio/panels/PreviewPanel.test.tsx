import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";

// Capture the Player element instance so a test can dispatch a synthetic
// "frameupdate" event matching Remotion's API and assert that the bridge
// pushes the frame into the Zustand store (Bug 1 — playhead bridge).
const playerRefs: Array<HTMLElement> = [];

vi.mock("@remotion/player", () => ({
  // Real PlayerRef is an imperative handle; PreviewPanel passes a ref to
  // Player and uses addEventListener/play/pause/isPlaying/seekTo. We expose
  // a handle whose addEventListener delegates to a hidden div so the test
  // can dispatch a synthetic "frameupdate" event with `detail.frame`.
  Player: forwardRef((props: any, ref: any) => {
    const elRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => {
      const handle = {
        addEventListener: (...args: any[]) =>
          // @ts-expect-error: forward to DOM
          elRef.current?.addEventListener(...args),
        removeEventListener: (...args: any[]) =>
          // @ts-expect-error: forward to DOM
          elRef.current?.removeEventListener(...args),
        play: () => {},
        pause: () => {},
        isPlaying: () => false,
        seekTo: () => {},
      };
      return handle;
    });
    return (
      <div
        ref={(el) => {
          elRef.current = el;
          if (el && !playerRefs.includes(el)) playerRefs.push(el);
        }}
        data-testid="player"
        data-fps={props.fps}
      />
    );
  }),
}));

describe("PreviewPanel", () => {
  it("renders the Player when comp is loaded", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.getByTestId("player")).toBeTruthy();
  });

  it("renders transport play/pause button", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.getByLabelText(/play|pause/i)).toBeTruthy();
  });

  it("does not render visual-only ref/compare tabs (D5 — deferred)", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.queryByText(/^参考$/)).toBeNull();
    expect(screen.queryByText(/^对比$/)).toBeNull();
  });

  it("bridges Remotion frameupdate events into useComposition.setFrame (Bug 1)", () => {
    playerRefs.length = 0;
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w1", duration: 10 }),
      currentFrame: 0,
    });
    render(<PreviewPanel />);
    const playerEl = playerRefs[0];
    expect(playerEl).toBeTruthy();

    // Remotion emits "frameupdate" with `{ detail: { frame } }`. Use a
    // CustomEvent so happy-dom delivers the matching `detail`.
    playerEl.dispatchEvent(new CustomEvent("frameupdate", { detail: { frame: 42 } }));
    expect(useComposition.getState().currentFrame).toBe(42);

    playerEl.dispatchEvent(new CustomEvent("frameupdate", { detail: { frame: 90 } }));
    expect(useComposition.getState().currentFrame).toBe(90);
  });
});
