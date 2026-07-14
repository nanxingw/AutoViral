import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Composition, VideoClip, Effect } from "../../types";

// PRD-0014 S14 — Inspector blend dropdown + effects-stack controls. Every control
// runs a shared op (setClipBlendMode → ops.patchClipProps; addClipEffect /
// toggleClipEffect / removeClipEffect → the effect ops), so the human Inspector
// and `autoviral clip effects …` / `clip set --blend` converge on ONE composition.

function compWithVideoClip(id: string, overrides: Partial<VideoClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-fx" });
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

describe("<StaticPropsPanel /> — blend + effects (S14)", () => {
  it("picking a blend mode writes blendMode through the shared op", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.change(screen.getByLabelText("Blend mode"), { target: { value: "screen" } });
    expect(liveVideo("v1").blendMode).toBe("screen");
  });

  it("adding an effect appends it to the clip's stack", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByLabelText("Add effect grade"));
    const effects = liveVideo("v1").effects as Effect[];
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("grade");
  });

  it("toggling an effect flips its enabled flag", () => {
    const effects: Effect[] = [{ id: "e1", type: "grade", params: {}, enabled: true }];
    useComposition.setState({ comp: compWithVideoClip("v1", { effects }), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByLabelText("Toggle effect"));
    expect((liveVideo("v1").effects as Effect[])[0].enabled).toBe(false);
  });

  it("removing an effect drops it from the stack", () => {
    const effects: Effect[] = [{ id: "e1", type: "blur", params: {}, enabled: true }];
    useComposition.setState({ comp: compWithVideoClip("v1", { effects }), selection: "v1" });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByLabelText("Remove effect"));
    expect((liveVideo("v1").effects as Effect[]).length).toBe(0);
  });

  it("renders the legacy filters projected as a grade entry in the list", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { filters: { brightness: 0.3, contrast: 0, saturation: 0 } }),
      selection: "v1",
    });
    const { container } = render(<StaticPropsPanel />);
    // resolveClipEffects projects the legacy filter → one grade entry shown.
    const entries = container.querySelectorAll('[data-test="effect-entry"]');
    expect(entries).toHaveLength(1);
    expect(entries[0].getAttribute("data-effect-type")).toBe("grade");
  });
});
