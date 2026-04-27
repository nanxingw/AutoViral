import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div
      data-testid="player"
      data-fps={props.fps}
      data-comp-w={props.compositionWidth}
    />
  ),
}));

describe("PreviewPanel", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
  });

  it("renders <Player> with comp dimensions when comp loaded", () => {
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w" }),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
    const { getByTestId } = render(<PreviewPanel />);
    expect(getByTestId("player").getAttribute("data-fps")).toBe("30");
    expect(getByTestId("player").getAttribute("data-comp-w")).toBe("1080");
  });

  it("renders empty state when comp is null", () => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
    });
    const { queryByTestId } = render(<PreviewPanel />);
    expect(queryByTestId("player")).toBeNull();
  });
});
