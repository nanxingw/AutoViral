import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Clip } from "./Clip";
import { useComposition } from "../../store";
import { useComposerDraft } from "@/stores/composerDraft";
import { makeEmptyComposition, type VideoClip } from "../../types";

beforeEach(() => {
  const c = makeEmptyComposition({ workId: "w" });
  c.tracks[0].clips.push({
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 4,
    trackOffset: 1,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  });
  c.assets.push({
    id: "source-x",
    uri: "x.mp4",
    kind: "video",
    metadata: { duration: 8 },
    status: "ready",
  });
  useComposition.setState({
    comp: c,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
  });
  useComposerDraft.setState({ nonce: 0, text: "" });
});

describe("Clip", () => {
  it("exposes its video kind and normal presentation state", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const clip = container.firstChild as HTMLElement;
    expect(clip).toHaveAttribute("data-kind", "video");
    expect(clip).toHaveAttribute("data-state", "normal");
  });

  it("exposes hover presentation state while the pointer is over the clip", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const clip = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(clip);
    expect(clip).toHaveAttribute("data-state", "hover");
  });

  it("exposes selected presentation state for the selected clip", () => {
    useComposition.setState({ selection: "v1" });
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    expect(container.firstChild).toHaveAttribute("data-state", "selected");
  });

  it("exposes dragging presentation state during an active body drag", () => {
    useComposition.setState({
      dragState: {
        clipId: "v1",
        originalStart: 1,
        candidateStart: 1,
        preview: new Map([["v1", 1]]),
        snapTime: null,
        targetTrackId: "video-main",
      },
    });
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    expect(container.firstChild).toHaveAttribute("data-state", "dragging");
  });

  it("exposes focus-visible presentation state when keyboard-focused", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const clip = container.firstChild as HTMLElement;
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(clip);
    expect(clip).toHaveAttribute("data-state", "focus-visible");
  });

  it("renders with proportional width", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");
    expect(el.style.left).toBe("50px");
  });

  it("clicking begins a drag and selects the clip", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(container.firstChild as HTMLElement, {
      clientX: 0,
      pointerId: 1,
    });
    expect(useComposition.getState().selection).toBe("v1");
    const ds = useComposition.getState().dragState;
    expect(ds?.clipId).toBe("v1");
    expect(ds?.originalStart).toBeCloseTo(1);
    expect(ds?.preview.get("v1")).toBeCloseTo(1);
  });

  it("dragState preview overrides clip.trackOffset for the rendered left edge", () => {
    useComposition.setState((s) => ({
      ...s,
      dragState: {
        clipId: "v1",
        originalStart: 1,
        candidateStart: 3,
        preview: new Map([["v1", 3]]),
        snapTime: null,
      },
    }));
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.left).toBe("150px");
  });

  it("renders left + right resize handles", () => {
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    expect(getByTestId("resize-left")).toBeInTheDocument();
    expect(getByTestId("resize-right")).toBeInTheDocument();
  });

  it("exposes 10px trim hit areas with visible rails", () => {
    useComposition.getState().setSelection("v1");
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    const left = getByTestId("resize-left");
    const right = getByTestId("resize-right");
    const leftRail = left.querySelector<HTMLElement>("[data-trim-rail]")!;
    const rightRail = right.querySelector<HTMLElement>("[data-trim-rail]")!;

    expect(left).toHaveAccessibleName("Trim clip start");
    expect(right).toHaveAccessibleName("Trim clip end");
    expect(getComputedStyle(left).width).toBe("10px");
    expect(getComputedStyle(right).width).toBe("10px");
    expect(getComputedStyle(left).left).toBe("0px");
    expect(getComputedStyle(right).right).toBe("0px");
    expect(getComputedStyle(leftRail).width).toBe("2px");
    expect(getComputedStyle(rightRail).width).toBe("2px");
    expect(getComputedStyle(leftRail).height).toBe("100%");
    expect(getComputedStyle(rightRail).height).toBe("100%");
  });

  it("modifier-click unions and toggles timeline selection", () => {
    const comp = useComposition.getState().comp!;
    comp.tracks[0].clips.push({
      ...(comp.tracks[0].clips[0] as VideoClip),
      id: "v2",
      trackOffset: 6,
    } as VideoClip);
    render(
      <>
        <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />
        <Clip clipId="v2" pxPerSecond={50} trackKind="video" color="var(--accent)" />
      </>,
    );
    const clips = document.querySelectorAll<HTMLElement>(".timeline-clip");
    fireEvent.pointerDown(clips[0], { button: 0, pointerId: 1 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(clips[1], { button: 0, pointerId: 2, shiftKey: true });
    fireEvent.pointerUp(window);
    expect(useComposition.getState().timelineSelection.ids).toEqual(["v1", "v2"]);

    fireEvent.pointerDown(clips[0], { button: 0, pointerId: 4 });
    expect(useComposition.getState().timelineSelection.ids).toEqual(["v1", "v2"]);
    expect(useComposition.getState().dragState?.preview.size).toBe(2);
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(clips[0], { button: 0, pointerId: 3, ctrlKey: true });
    fireEvent.pointerUp(window);
    expect(useComposition.getState().timelineSelection.ids).toEqual(["v2"]);
    expect(useComposition.getState().selection).toBe("v2");
  });

  it("renders the full-source dashed ghost while trimming", () => {
    useComposition.getState().comp!.assets.push({
      id: "source",
      uri: "x.mp4",
      kind: "video",
      metadata: { duration: 8 },
      status: "ready",
    });
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(getByTestId("resize-left"), {
      button: 0,
      clientX: 0,
      pointerId: 7,
    });
    const ghost = getByTestId("source-ghost");
    expect(ghost).toHaveStyle({ left: "50px", width: "400px" });
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId("source-ghost")).not.toBeInTheDocument();
  });

  it("pointerdown on the right handle does NOT begin a body-drag (4.B regression)", () => {
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(getByTestId("resize-right"), {
      clientX: 0,
      pointerId: 7,
    });
    // body-drag would set dragState; resize doesn't touch dragState.
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("right handle pointermove dispatches resizeClip (out grows)", () => {
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(getByTestId("resize-right"), {
      clientX: 0,
      pointerId: 7,
    });
    // anchor = trackOffset(1) + dur(4) = 5; +50px → +1s → newTime = 6 → out = 0 + (6-1) = 5
    fireEvent(
      window,
      new PointerEvent("pointermove", { clientX: 50 }),
    );
    fireEvent(window, new PointerEvent("pointerup"));
    const v = useComposition.getState().comp!.tracks[0].clips.find(
      (c) => c.id === "v1",
    )! as { out: number };
    expect(v.out).toBeCloseTo(5);
  });

  // #5 — right-click "加入聊天上下文" context menu.
  it("right-click opens the add-to-context menu and selects the clip", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.contextMenu(container.firstChild as HTMLElement, {
      clientX: 40,
      clientY: 40,
    });
    // selecting the clip is what makes the viewer-context envelope carry its id
    expect(useComposition.getState().selection).toBe("v1");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem")).toBeInTheDocument();
  });

  it("clicking the menu item injects the clip reference into the composer draft", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.contextMenu(container.firstChild as HTMLElement, {
      clientX: 40,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole("menuitem"));
    // noun prefix is locale-dependent; assert on the locale-agnostic
    // name「x」 + (1.0s) offset built from src "/x.mp4" at trackOffset 1.
    expect(useComposerDraft.getState().text).toMatch(/「x」\(1\.0s\)/);
  });

  it("right-click (button 2) pointerdown does NOT begin a body-drag", () => {
    const { container } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(container.firstChild as HTMLElement, {
      clientX: 0,
      pointerId: 9,
      button: 2,
    });
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("Escape during a resize drag reverts the clip", () => {
    const { getByTestId } = render(
      <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
    );
    fireEvent.pointerDown(getByTestId("resize-right"), {
      clientX: 0,
      pointerId: 7,
    });
    fireEvent(
      window,
      new PointerEvent("pointermove", { clientX: 50 }),
    );
    // mid-drag: out should be 5 (4 + 1)
    const mid = useComposition.getState().comp!.tracks[0].clips.find(
      (c) => c.id === "v1",
    )! as { out: number };
    expect(mid.out).toBeCloseTo(5);
    fireEvent.keyDown(window, { key: "Escape" });
    const after = useComposition.getState().comp!.tracks[0].clips.find(
      (c) => c.id === "v1",
    )! as { out: number };
    // anchorTime = 1 + 4 = 5 → out reverts to 0 + (5 - 1) = 4
    expect(after.out).toBeCloseTo(4);
  });
});
