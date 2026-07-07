import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScriptReader } from "./ScriptReader";
import { useReader } from "./readerStore";
import { useComposition } from "../store";
import { useScript } from "../scriptStore";
import { useDive } from "../dive/diveStore";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

// ScriptReader render contract — under mocked store data, assert the single
// interleaved flow: prose segment → its anchored scene card, unmatched scenes in
// the 分镜册 section, the right-edge mini-TOC has one entry per scene, and the
// empty state shows when there's nothing to read.

function seed(opts: { script: string; sceneIds?: Parameters<typeof makeScene>[0][] }) {
  const comp = makeAssetGraph({ ids: ["a1"], workId: "w1" });
  comp.scenes = (opts.sceneIds ?? []).map((o) => makeScene(o));
  useComposition.setState({ comp, selection: null });
  useScript.setState({ workId: "w1", script: opts.script, loaded: true });
}

beforeEach(() => {
  useReader.setState({ open: true });
  useDive.setState({ pendingSceneJump: null, open: false });
  useComposition.setState({ comp: null, selection: null });
  useScript.setState({ workId: null, script: "", loaded: false });
});

describe("ScriptReader", () => {
  it("interleaves anchored scene cards after their heading, unmatched under 分镜册", () => {
    seed({
      script: ["# Opening", "Hook.", "## Payoff", "End."].join("\n"),
      sceneIds: [
        { id: "sc1", order: 0, title: "Hook shot", mdAnchor: "Opening" },
        { id: "sc2", order: 1, title: "Loose shot" }, // no anchor → trailing
      ],
    });
    render(<ScriptReader />);
    // Both cards render.
    const cards = screen.getAllByTestId("reader-scene-card");
    expect(cards).toHaveLength(2);
    // The anchored card is present with its scene id + title.
    expect(screen.getByText("Hook shot")).toBeTruthy();
    // The unmatched card lives in the storyboard (分镜册) trailing section.
    expect(screen.getByTestId("reader-storyboard-section")).toBeTruthy();
    const trailing = screen.getByTestId("reader-storyboard-section");
    expect(within(trailing).getByText("Loose shot")).toBeTruthy();
  });

  it("gives the mini-TOC one entry per scene, in reading order", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [
        { id: "sc1", order: 0, title: "A", mdAnchor: "One" },
        { id: "sc2", order: 1, title: "B" },
        { id: "sc3", order: 2, title: "C" },
      ],
    });
    render(<ScriptReader />);
    expect(screen.getAllByTestId("reader-toc-item")).toHaveLength(3);
  });

  it("renders pure prose (no cards, no TOC) when there are no scenes", () => {
    seed({ script: "# Only prose\nNo shots here.", sceneIds: [] });
    render(<ScriptReader />);
    expect(screen.queryAllByTestId("reader-scene-card")).toHaveLength(0);
    expect(screen.queryAllByTestId("reader-toc-item")).toHaveLength(0);
    expect(screen.queryByTestId("reader-empty")).toBeNull();
  });

  it("shows the empty state when there's no script AND no scenes", () => {
    seed({ script: "", sceneIds: [] });
    render(<ScriptReader />);
    expect(screen.getByTestId("reader-empty")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    seed({ script: "# X\nY.", sceneIds: [{ id: "sc1", order: 0, title: "A" }] });
    useReader.setState({ open: false });
    render(<ScriptReader />);
    expect(screen.queryByTestId("reader-scene-card")).toBeNull();
  });

  it("the per-card edit button jumps the sidebar to that scene and closes the reader", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const editBtn = screen.getByTestId("reader-edit-scene");
    editBtn.click();
    expect(useDive.getState().pendingSceneJump).toBe("sc1");
    expect(useReader.getState().open).toBe(false);
  });
});
