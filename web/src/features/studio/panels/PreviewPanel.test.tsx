import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => <div data-testid="player" data-fps={props.fps} />,
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
});
