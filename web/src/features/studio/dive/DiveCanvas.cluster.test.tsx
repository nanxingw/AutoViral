import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
  BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
  Controls: () => null,
  MiniMap: () => null,
  Panel: () => null,
  MarkerType: { Arrow: "arrow", ArrowClosed: "arrowclosed" },
  useReactFlow: () => ({ zoomIn: () => {}, zoomOut: () => {}, fitView: () => {} }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  // Item 3 — DiveEdge (imported via edgeTypes) pulls getBezierPath; the mocked
  // ReactFlow never renders edges so it's never called, but the import binding
  // must resolve.
  getBezierPath: () => ["M0 0", 0, 0],
  BaseEdge: () => null,
}));

import { DiveCanvas } from "./DiveCanvas";
import { useComposition } from "../store";
import { useDive } from "./diveStore";
import { CLUSTER_FOLDED_HEIGHT, CLUSTER_FOLDED_WIDTH } from "./clusterLayout";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

beforeEach(() => {
  captured.props = null;
  useComposition.setState({ comp: null, selection: null });
  // B6 — the canvas chrome (view toggle + unassigned fold) lives in a shared
  // store; reset it so a prior test's toggle never bleeds into the next.
  useDive.setState({
    open: true,
    view: "scene",
    unassignedCollapsed: true,
    pendingSceneJump: null,
    memoWorkId: null,
  });
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
    // B6 — the unassigned cluster now starts collapsed; expand it so its
    // member ("loose") is emitted for this parentId assertion.
    useDive.setState({ unassignedCollapsed: false });
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

describe("DiveCanvas — B6 chrome (unassigned fold + view toggle)", () => {
  it("collapses the unassigned cluster by default: its children are hidden, the group stays", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose1", "loose2"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    // default unassignedCollapsed = true
    render(<DiveCanvas open={true} onClose={() => {}} />);
    // The unassigned group node is present (collapsed) but its members are NOT.
    const groupIds = groupNodes().map((n) => n.id);
    expect(groupIds).toContain("__unassigned__");
    expect(nodesOf().find((n) => n.id === "loose1")).toBeUndefined();
    expect(nodesOf().find((n) => n.id === "loose2")).toBeUndefined();
    // The scene cluster's own child is unaffected.
    expect(nodesOf().find((n) => n.id === "a")?.parentId).toBe("sc1");
    // The group node carries collapsed + memberCount for the fold affordance.
    const unassigned = nodesOf().find((n) => n.id === "__unassigned__");
    expect((unassigned?.data as { collapsed?: boolean })?.collapsed).toBe(true);
    expect((unassigned?.data as { memberCount?: number })?.memberCount).toBe(2);
  });

  it("reveals the unassigned members once expanded", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose1"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    useDive.setState({ unassignedCollapsed: false });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(nodesOf().find((n) => n.id === "loose1")?.parentId).toBe("__unassigned__");
  });

  it("keeps a sole unassigned cluster expanded even when the collapse flag is set (no scenes → nothing else to show)", () => {
    const comp = makeAssetGraph({ ids: ["a", "b"] });
    // No scenes → everything is unassigned; collapsing it would blank the canvas.
    useComposition.setState({ comp, selection: null });
    useDive.setState({ unassignedCollapsed: true });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(nodesOf().find((n) => n.id === "a")?.parentId).toBe("__unassigned__");
    expect(nodesOf().find((n) => n.id === "b")?.parentId).toBe("__unassigned__");
  });

  it("lineage view renders a FLAT provenance graph — no group nodes, no parentId", () => {
    const comp = makeAssetGraph({ ids: ["a", "b"], edges: [["a", "b"]] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a", "b"] })];
    useComposition.setState({ comp, selection: null });
    useDive.setState({ view: "lineage" });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(groupNodes()).toHaveLength(0);
    expect(childNodes()).toHaveLength(0); // nothing has a parentId in lineage view
    expect(nodesOf().find((n) => n.id === "a")).toBeDefined();
    expect(nodesOf().find((n) => n.id === "b")).toBeDefined();
    // Provenance edge survives.
    expect((captured.props?.edges as { source: string; target: string }[]).some(
      (e) => e.source === "a" && e.target === "b",
    )).toBe(true);
  });

  it("scene view (default) renders group nodes; the header toggle flips the store to lineage", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(groupNodes().length).toBeGreaterThan(0);
    // The lineage toggle is a real control in the canvas header.
    act(() => {
      fireEvent.click(screen.getByTestId("dive-view-lineage"));
    });
    expect(useDive.getState().view).toBe("lineage");
  });
});

describe("DiveCanvas — Item 1 folded poker-fan + Item 3 custom edge", () => {
  it("a folded unassigned cluster takes the compact folded box + a stackPreview (first member + count)", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose1", "loose2", "loose3"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    // default unassignedCollapsed = true → folded
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const unassigned = nodesOf().find((n) => n.id === "__unassigned__")!;
    // Folded box is the compact fixed size, not the (wide) expanded layout box.
    expect((unassigned.style as { width?: number }).width).toBe(CLUSTER_FOLDED_WIDTH);
    expect((unassigned.style as { height?: number }).height).toBe(CLUSTER_FOLDED_HEIGHT);
    // Preview carries the FIRST member as the fan's top card + total count.
    const preview = (unassigned.data as { stackPreview?: { asset: { id: string }; count: number } })
      .stackPreview;
    expect(preview).toBeDefined();
    expect(preview!.asset.id).toBe("loose1");
    expect(preview!.count).toBe(3); // loose1, loose2, loose3
  });

  it("an EXPANDED unassigned cluster carries no stackPreview and uses its full layout box", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose1"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    useDive.setState({ unassignedCollapsed: false });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const unassigned = nodesOf().find((n) => n.id === "__unassigned__")!;
    expect((unassigned.data as { stackPreview?: unknown }).stackPreview).toBeUndefined();
    expect((unassigned.style as { width?: number }).width).not.toBe(CLUSTER_FOLDED_WIDTH);
  });

  it("registers the custom edge type and defaults provenance edges to it", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const edgeTypes = captured.props?.edgeTypes as Record<string, unknown>;
    expect(edgeTypes).toBeDefined();
    expect(edgeTypes.dive).toBeDefined();
    const def = captured.props?.defaultEdgeOptions as { type?: string };
    expect(def.type).toBe("dive");
  });

  it("passes the entrance window to unassigned members after an expand", () => {
    const comp = makeAssetGraph({ ids: ["a", "loose1"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["a"] })];
    useComposition.setState({ comp, selection: null });
    // Simulate an expand: bucket open + a recent expand timestamp.
    useDive.setState({ unassignedCollapsed: false, lastExpandAt: Date.now() });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const loose = nodesOf().find((n) => n.id === "loose1");
    expect((loose?.data as { enterTs?: number }).enterTs).toBeGreaterThan(0);
    // A scene-cluster member never gets an entrance (always on-screen).
    const sceneChild = nodesOf().find((n) => n.id === "a");
    expect((sceneChild?.data as { enterTs?: number }).enterTs).toBeUndefined();
  });
});
