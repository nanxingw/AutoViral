import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Node } from "@xyflow/react";

// B5 (PRD-0010) — assert the CLUSTERED graph DiveCanvas hands to ReactFlow,
// independent of happy-dom layout. We stub @xyflow/react with a prop-capturing
// ReactFlow so we can read `nodes` / `onlyRenderVisibleElements` directly.
const captured: { props: Record<string, unknown> | null } = { props: null };
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="rf-mock" />;
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import { DiveCanvas } from "./DiveCanvas";
import { useComposition } from "../store";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

beforeEach(() => {
  captured.props = null;
  useComposition.setState({ comp: null, selection: null });
});

function nodesOf(): Node[] {
  return (captured.props?.nodes as Node[]) ?? [];
}
function groupNodes(): Node[] {
  return nodesOf().filter((n) => n.type === "sceneGroup");
}
function childNodes(): Node[] {
  return nodesOf().filter((n) => n.parentId != null);
}

describe("DiveCanvas — clustered rendering", () => {
  it("renders one group node per cluster", () => {
    const comp = makeAssetGraph({ ids: ["a", "b", "loose"] });
    comp.scenes = [
      makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] }),
      makeScene({ id: "sc2", order: 1, memberAssetIds: ["b"] }),
    ];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    // sc1 + sc2 + unassigned(loose) = 3 clusters.
    expect(groupNodes()).toHaveLength(3);
    const ids = groupNodes().map((n) => n.id);
    expect(ids).toContain("sc1");
    expect(ids).toContain("sc2");
    expect(ids).toContain("__unassigned__");
  });

  it("enables onlyRenderVisibleElements", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(captured.props?.onlyRenderVisibleElements).toBe(true);
  });

  it("wires every asset node to its cluster via parentId", () => {
    const comp = makeAssetGraph({ ids: ["a", "b", "loose"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a", "b"] })];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const kids = childNodes();
    expect(kids).toHaveLength(3); // a, b, loose
    const groupIds = new Set(groupNodes().map((n) => n.id));
    for (const kid of kids) {
      expect(groupIds.has(kid.parentId as string)).toBe(true);
    }
    expect(nodesOf().find((n) => n.id === "a")?.parentId).toBe("sc1");
    expect(nodesOf().find((n) => n.id === "loose")?.parentId).toBe("__unassigned__");
  });

  it("places every group node before its children in the node array", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const all = nodesOf();
    const lastGroupIdx = all.reduce(
      (acc, n, i) => (n.type === "sceneGroup" ? i : acc),
      -1,
    );
    const firstChildIdx = all.findIndex((n) => n.parentId != null);
    expect(firstChildIdx).toBeGreaterThan(lastGroupIdx);
  });

  it("flags the selected take on its node data", () => {
    const comp = makeAssetGraph({ ids: ["g1", "g2"] });
    comp.scenes = [
      makeScene({
        id: "sc1",
        order: 0,
        generatedAssetIds: ["g1", "g2"],
        selectedAssetId: "g2",
      }),
    ];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const g2 = nodesOf().find((n) => n.id === "g2");
    const g1 = nodesOf().find((n) => n.id === "g1");
    expect((g2?.data as { isSelectedTake?: boolean })?.isSelectedTake).toBe(true);
    expect((g1?.data as { isSelectedTake?: boolean })?.isSelectedTake).toBe(false);
  });
});
