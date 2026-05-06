import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VariantSwitcher } from "./VariantSwitcher";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

function setupCompWithClipBoundToAsset(boundAssetId: string) {
  // Build a graph where boundAssetId is a child with 2 siblings.
  const comp = makeAssetGraph({
    ids: ["root", "alpha", "beta", "gamma"],
    edges: [["root", "alpha"], ["root", "beta"], ["root", "gamma"]],
  });
  // Bind a clip to alpha (uri "/assets/alpha.png" by fixture default).
  const clip = makeVideoClip({
    id: "clip-1",
    src: `/assets/${boundAssetId}.png`,
  });
  comp.tracks[0].clips.push(clip);
  return { comp, clipId: clip.id };
}

describe("VariantSwitcher", () => {
  it("renders an empty-state hint when no clip is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    render(<VariantSwitcher />);
    expect(screen.getByText(/no clip selected/i)).toBeInTheDocument();
  });

  it("renders 'no variants' when the bound asset has zero siblings", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    const clip = makeVideoClip({ id: "c", src: "/assets/solo.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<VariantSwitcher />);
    expect(screen.getByText(/no variants/i)).toBeInTheDocument();
  });

  it("renders one tile per sibling variant", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    render(<VariantSwitcher />);
    // Two siblings of alpha: beta + gamma.
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
    expect(screen.getByTestId("variant-tile-gamma")).toBeInTheDocument();
  });

  it("clicking USE THIS calls rebindClip with the right new asset id", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    const spy = vi.spyOn(useComposition.getState(), "rebindClip");
    render(<VariantSwitcher />);
    const useBetaBtn = screen.getByTestId("use-variant-beta");
    fireEvent.click(useBetaBtn);
    expect(spy).toHaveBeenCalledWith(clipId, "beta");
  });

  it("shows the currently-bound asset's id in a 'current' badge", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    render(<VariantSwitcher />);
    expect(screen.getByText(/current/i)).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
