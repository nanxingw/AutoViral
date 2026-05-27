import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorTab } from "./InspectorTab";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

describe("InspectorTab", () => {
  it("shows VariantSwitcher when a clip is selected", () => {
    const comp = makeAssetGraph({
      ids: ["root", "alpha", "beta"],
      edges: [["root", "alpha"], ["root", "beta"]],
    });
    const clip = makeVideoClip({ id: "c", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<InspectorTab />);
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
  });

  it("shows the no-selection empty state when nothing is selected", () => {
    // VariantSwitcher now distinguishes "timeline has clips but none selected"
    // (emptyNoSelection: "No clip selected — pick one in the timeline") from
    // "timeline empty" (emptyNoClipsYet). To exercise the genuine
    // no-selection state we mount a comp WITH a clip but leave selection null.
    const comp = makeAssetGraph({
      ids: ["root", "alpha"],
      edges: [["root", "alpha"]],
    });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/alpha.png" }));
    useComposition.setState({ comp, selection: null });
    render(<InspectorTab />);
    expect(screen.getByText(/no clip selected/i)).toBeInTheDocument();
  });

  it("mounts KeyframePanel below VariantSwitcher (Phase 8.2.D)", () => {
    // No selection → KeyframePanel empty-state copy should render alongside
    // the VariantSwitcher empty state.
    useComposition.setState({ comp: null, selection: null });
    render(<InspectorTab />);
    expect(
      screen.getByText(/select a clip in the timeline to add keyframes/i),
    ).toBeInTheDocument();
  });

  it("renders the 'Open in Dive' button (Phase 5.C trigger)", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "c", src: "/assets/b.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<InspectorTab />);
    expect(screen.getByRole("button", { name: /open in dive/i })).toBeInTheDocument();
  });
});
