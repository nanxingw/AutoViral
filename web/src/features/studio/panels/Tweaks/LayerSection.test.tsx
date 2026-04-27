import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { LayerSection } from "./LayerSection";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";

beforeEach(() => {
  const c = makeEmptyComposition({ workId: "w" });
  c.tracks[0].clips.push({
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  });
  useComposition.setState({
    comp: c,
    selection: "v1",
    currentFrame: 0,
    isPlaying: false,
  });
});

describe("LayerSection", () => {
  it("brightness slider writes through to store on selected video clip", () => {
    const { getByTestId } = render(<LayerSection />);
    const slider = getByTestId("layer-brightness") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.5" } });
    const v = useComposition.getState().comp!.tracks[0].clips[0];
    if (v.kind !== "video") throw new Error("expected video");
    expect(v.filters.brightness).toBeCloseTo(0.5, 5);
  });

  it("renders empty hint when nothing is selected", () => {
    useComposition.setState({ selection: null });
    const { getByText } = render(<LayerSection />);
    expect(getByText(/选中时间轴/)).toBeInTheDocument();
  });
});
