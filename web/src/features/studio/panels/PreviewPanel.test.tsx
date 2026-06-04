import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";

// Capture the Player element instance so a test can dispatch a synthetic
// "frameupdate" event matching Remotion's API and assert that the bridge
// pushes the frame into the Zustand store (Bug 1 — playhead bridge).
const playerRefs: Array<HTMLElement> = [];
// #74 — record imperative volume calls so tests can assert the transport
// controls actually drive the PlayerRef.
const volumeLog: { volume: number; muted: boolean } = { volume: 1, muted: false };

vi.mock("@remotion/player", () => ({
  // Real PlayerRef is an imperative handle; PreviewPanel passes a ref to
  // Player and uses addEventListener/play/pause/isPlaying/seekTo + (#74)
  // setVolume/mute/unmute/isMuted. We expose a handle whose addEventListener
  // delegates to a hidden div so the test can dispatch a synthetic
  // "frameupdate" event, and whose volume methods write to `volumeLog`.
  // `playbackRate` is reflected onto a data attribute so the speed test can
  // assert the declarative prop flows through.
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
        setVolume: (v: number) => {
          volumeLog.volume = v;
        },
        getVolume: () => volumeLog.volume,
        isMuted: () => volumeLog.muted,
        mute: () => {
          volumeLog.muted = true;
        },
        unmute: () => {
          volumeLog.muted = false;
        },
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
        data-playback-rate={props.playbackRate}
        // S17 — reflect the canvas dimensions the Player consumes so the
        // aspect-switch renderer-consumption test can assert comp.width/height
        // actually flow into <Player compositionWidth/compositionHeight>.
        data-comp-width={props.compositionWidth}
        data-comp-height={props.compositionHeight}
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

  // S17 (US 26) — renderer-consumption proof: switching aspect via the store
  // action (which routes through the shared ops.setAspectRatio) must flow the
  // new canvas dimensions into the <Player compositionWidth/compositionHeight>
  // — i.e. the schema field is REALLY consumed by the preview renderer, not a
  // dead round-trip field. Without this the aspect switch would not change the
  // visible canvas at all.
  it("setAspectRatio store action flows new dims into the Player (renderer consumption)", () => {
    // 9:16 default (1080×1920) → 16:9.
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    const { rerender } = render(<PreviewPanel />);
    const before = screen.getByTestId("player");
    expect(before.getAttribute("data-comp-width")).toBe("1080");
    expect(before.getAttribute("data-comp-height")).toBe("1920");

    // Switch ratio through the real store action (→ shared op).
    useComposition.getState().setAspectRatio("16:9");
    rerender(<PreviewPanel />);

    const after = screen.getByTestId("player");
    expect(after.getAttribute("data-comp-width")).toBe("1920");
    expect(after.getAttribute("data-comp-height")).toBe("1080");
    // And the store comp really flipped (single source of truth).
    expect(useComposition.getState().comp?.aspect).toBe("16:9");
  });

  it("clicking the header 16:9 aspect button flips the canvas dims the Player consumes (UI → op)", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    // Default 9:16 → the 9:16 button is active, dims are 1080×1920.
    expect(screen.getByRole("button", { name: "9:16" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("player").getAttribute("data-comp-width")).toBe("1080");

    fireEvent.click(screen.getByRole("button", { name: "16:9" }));

    // The op ran: store flipped AND the Player re-rendered with the new dims.
    expect(useComposition.getState().comp?.aspect).toBe("16:9");
    const player = screen.getByTestId("player");
    expect(player.getAttribute("data-comp-width")).toBe("1920");
    expect(player.getAttribute("data-comp-height")).toBe("1080");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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

  // #74 — Volume and Speed transport controls used to be dead (aria-label +
  // cursor but no onClick). These pin the wiring to the PlayerRef / prop.
  describe("transport volume + speed (#74)", () => {
    beforeEach(() => {
      volumeLog.volume = 1;
      volumeLog.muted = false;
    });

    it("the volume slider drives PlayerRef.setVolume", () => {
      useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
      render(<PreviewPanel />);
      const slider = screen.getByLabelText("Volume") as HTMLInputElement;
      fireEvent.change(slider, { target: { value: "0.4" } });
      expect(volumeLog.volume).toBeCloseTo(0.4);
    });

    it("the mute button toggles PlayerRef mute/unmute and flips its label", () => {
      useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
      render(<PreviewPanel />);
      // Starts unmuted → button offers "Mute".
      const muteBtn = screen.getByRole("button", { name: /^mute$/i });
      fireEvent.click(muteBtn);
      expect(volumeLog.muted).toBe(true);
      // Now labelled "Unmute" + aria-pressed.
      const unmuteBtn = screen.getByRole("button", { name: /^unmute$/i });
      expect(unmuteBtn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(unmuteBtn);
      expect(volumeLog.muted).toBe(false);
    });

    it("the speed button cycles 1× → 1.5× and feeds the Player playbackRate prop", () => {
      playerRefs.length = 0;
      useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
      render(<PreviewPanel />);
      // Default rate 1×.
      expect(screen.getByRole("button", { name: /speed/i })).toHaveTextContent("1×");
      expect(playerRefs[0]).toHaveAttribute("data-playback-rate", "1");
      fireEvent.click(screen.getByRole("button", { name: /speed/i }));
      expect(screen.getByRole("button", { name: /speed/i })).toHaveTextContent("1.5×");
      // The declarative prop reaches <Player>.
      expect(playerRefs.at(-1)).toHaveAttribute("data-playback-rate", "1.5");
    });
  });
});
