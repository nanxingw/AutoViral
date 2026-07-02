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

  // B6 (PRD-0010) — the Dive-canvas entry moved out of the Inspector depth up to
  // the Studio top bar. The Inspector must no longer render its own trigger.
  it("no longer renders an 'Open in Dive' button (moved to the top bar in B6)", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "c", src: "/assets/b.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<InspectorTab />);
    expect(screen.queryByRole("button", { name: /open in dive/i })).toBeNull();
  });
});
