import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiveCanvas } from "./DiveCanvas";
import { useComposition } from "../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../test/composition-fixtures";

describe("DiveCanvas", () => {
  it("renders a node per asset in comp.assets", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c"],
      edges: [["a", "b"], ["a", "c"]],
    });
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(screen.getByTestId("dive-node-a")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-b")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-c")).toBeInTheDocument();
  });

  it("renders nothing when open=false", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp });
    render(<DiveCanvas open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("dive-node-a")).toBeNull();
  });

  it("USE THIS on a node calls rebindClip with the selected clip and that node's asset", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/a.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });
    const spy = vi.spyOn(useComposition.getState(), "rebindClip");
    render(<DiveCanvas open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("dive-use-b"));
    expect(spy).toHaveBeenCalledWith("clip-1", "b");
  });

  it("the currently-bound asset's USE button is disabled and labelled CURRENT", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/a.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const currentBtn = screen.getByTestId("dive-use-a");
    expect(currentBtn).toBeDisabled();
    expect(currentBtn.textContent).toMatch(/current/i);
  });

  it("ESC key calls onClose", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    const onClose = vi.fn();
    render(<DiveCanvas open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("backdrop click calls onClose", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    const onClose = vi.fn();
    render(<DiveCanvas open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("dive-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an empty-state message when comp has no assets", () => {
    const comp = makeAssetGraph({ ids: [] });
    useComposition.setState({ comp });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(screen.getByText(/no assets yet/i)).toBeInTheDocument();
  });
});
