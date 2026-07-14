import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Composition, VideoClip } from "../../types";

// PRD-0014 S13 — Inspector mask controls (shape + feather + inverted + letterbox
// preset). Every control runs the shared `setClipMask` store action
// (→ ops.setClipMask), so the human Inspector and `autoviral clip mask` converge
// on ONE composition.

function compWithVideoClip(id: string, overrides: Partial<VideoClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-mask" });
  const clip: VideoClip = {
    id,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks.find((t) => t.kind === "video")!.clips as VideoClip[]).push(clip);
  return c;
}

function liveVideo(id: string) {
  return useComposition
    .getState()
    .comp!.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === id) as VideoClip;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("<StaticPropsPanel /> — mask (S13)", () => {
  it("shows a mask shape selector for a video clip", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    expect(screen.getByLabelText("Mask shape")).toBeInTheDocument();
  });

  it("picking ellipse writes a mask through the shared op", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Mask shape"), {
      target: { value: "ellipse" },
    });
    expect(liveVideo("v1").mask?.type).toBe("ellipse");
  });

  it("selecting None clears an existing mask", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { mask: { type: "ellipse", feather: 0.2 } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Mask shape"), {
      target: { value: "__none__" },
    });
    expect(liveVideo("v1").mask).toBeUndefined();
  });

  it("adjusting feather updates mask.feather (spread-guards the shape)", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { mask: { type: "ellipse" } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Feather"), { target: { value: "0.5" } });
    const clip = liveVideo("v1");
    expect(clip.mask?.feather).toBeCloseTo(0.5, 5);
    // shape preserved (spread-guard, #81 lesson)
    expect(clip.mask?.type).toBe("ellipse");
  });

  it("toggling invert sets mask.inverted (spread-guards the shape)", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { mask: { type: "rect" } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByLabelText("Invert mask"));
    const clip = liveVideo("v1");
    expect(clip.mask?.inverted).toBe(true);
    expect(clip.mask?.type).toBe("rect");
  });

  it("the letterbox button applies the 2.35:1 preset (a centered rect band)", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByLabelText("Letterbox 2.35:1"));
    const clip = liveVideo("v1");
    expect(clip.mask?.type).toBe("rect");
    expect(clip.mask?.rect?.w).toBe(1);
    expect(clip.mask?.rect?.h).toBeGreaterThan(0);
    expect(clip.mask?.rect?.h).toBeLessThan(1);
    // Review-fix (finding #1) — the letterbox preset KEEPS the central band under
    // the keep-inside default, so it is NON-inverted. Pin that so a future drift
    // can't silently re-add `inverted` (which would keep the BARS and hide the
    // content — the opposite of a letterbox).
    expect(clip.mask).not.toHaveProperty("inverted");
  });
});
