import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BladeTool } from "./BladeTool";
import { useComposition } from "../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  useComposition.setState({
    comp: makeCompositionWithClips([a]),
    selection: "a",
    bladeMode: true,
    currentFrame: 0,
    dragState: null,
  });
  // jsdom's getBoundingClientRect returns zeros — stub it so clientX
  // math lines up with the overlay's absolute position.
  const proto = HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => DOMRect;
  };
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        left: 110,
        top: 0,
        right: 510,
        bottom: 80,
        width: 400,
        height: 80,
        x: 110,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

describe("BladeTool", () => {
  it("renders nothing when bladeMode is off", () => {
    useComposition.setState({ bladeMode: false });
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("clicking at clientX over a clip splits it at the corresponding time", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "uuid-blade" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    // overlay.left = 110 (label col); clientX 210 → relative 100px → t=2s
    fireEvent.click(overlay, { clientX: 210 });
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(2);
    expect(clips.some((c) => c.id === "uuid-blade")).toBe(true);
    vi.restoreAllMocks();
  });

  it("does not split when the click lands in a gap (D4)", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 1 }),
        makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1 }),
      ]),
      bladeMode: true,
    });
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    // clientX 210 → relative 100px → t=2 → in the gap [1..3]
    fireEvent.click(overlay, { clientX: 210 });
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
  });

  it("renders a hover indicator on pointermove", () => {
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.children.length).toBe(0);
    fireEvent.pointerMove(overlay, { clientX: 210 });
    // After pointermove a single vertical guide should be present.
    expect(overlay.children.length).toBe(1);
  });

  it("clears the hover indicator on pointerleave", () => {
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    fireEvent.pointerMove(overlay, { clientX: 210 });
    expect(overlay.children.length).toBe(1);
    fireEvent.pointerLeave(overlay);
    expect(overlay.children.length).toBe(0);
  });
});
