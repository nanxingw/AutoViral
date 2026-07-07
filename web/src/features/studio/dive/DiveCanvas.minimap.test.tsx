import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Node } from "@xyflow/react";

// 画布-F2 — the Dive MiniMap rendered ZERO node rects even though its viewBox
// bounds were computed correctly. Root cause: xyflow's MiniMap draws a <rect>
// per node ONLY when `nodeHasDimensions(node.internals.userNode)` is true, i.e.
// the USER node object carries `measured` / `width` / `initialWidth`. DiveCanvas
// feeds ReactFlow as a CONTROLLED `nodes` prop with NO `onNodesChange`, so the
// dimensions xyflow measures land on the internal nodeLookup (→ bounds correct)
// but are NEVER written back onto `internals.userNode` (→ minimap sees a
// dimensionless node → renders no rect). `onlyRenderVisibleElements` compounds
// it by culling off-screen nodes from measurement entirely.
//
// The fix is to hand every node an explicit dimension hint the minimap can read
// without waiting on DOM measurement. This suite mirrors xyflow's own
// `nodeHasDimensions` gate against the exact `nodes` prop DiveCanvas emits.
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
  getBezierPath: () => ["M0 0", 0, 0],
  BaseEdge: () => null,
}));

import { DiveCanvas } from "./DiveCanvas";
import { useComposition } from "../store";
import { useDive } from "./diveStore";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

beforeEach(() => {
  captured.props = null;
  useComposition.setState({ comp: null, selection: null });
  useDive.setState({
    open: true,
    view: "scene",
    unassignedCollapsed: false,
    pendingSceneJump: null,
    memoWorkId: null,
  });
});

function nodesOf(): Node[] {
  return (captured.props?.nodes as Node[]) ?? [];
}

// Mirror @xyflow/system `nodeHasDimensions` + `getNodeDimensions`: the MiniMap
// resolves each rect's size from `measured?.w ?? width ?? initialWidth` on the
// user node and renders nothing when both fall through to undefined.
function minimapWouldRender(n: Node): boolean {
  const raw = n as Node & {
    measured?: { width?: number; height?: number };
    initialWidth?: number;
    initialHeight?: number;
  };
  const w = raw.measured?.width ?? raw.width ?? raw.initialWidth;
  const h = raw.measured?.height ?? raw.height ?? raw.initialHeight;
  return typeof w === "number" && w > 0 && typeof h === "number" && h > 0;
}

describe("DiveCanvas — MiniMap node dimensions", () => {
  it("scene view: every group + child node carries a minimap-renderable dimension", () => {
    const comp = makeAssetGraph({
      ids: ["img", "aud", "sub"],
      overrides: {
        aud: { kind: "audio", uri: "/aud.mp3" },
        sub: { kind: "subtitle", uri: "/sub.srt" },
      },
    });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["img"] })];
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);

    const nodes = nodesOf();
    // sceneGroup sc1 + sceneGroup __unassigned__ + 3 asset children.
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    // Every node type present: sceneGroup / visual / audio / text.
    const types = new Set(nodes.map((n) => n.type));
    expect(types).toEqual(new Set(["sceneGroup", "visual", "audio", "text"]));

    for (const n of nodes) {
      expect(
        minimapWouldRender(n),
        `node ${n.id} (${n.type}) has no minimap-renderable width/height`,
      ).toBe(true);
    }
  });

  it("lineage view: every flat node carries a minimap-renderable dimension", () => {
    const comp = makeAssetGraph({
      ids: ["img", "aud", "sub"],
      edges: [["img", "aud"]],
      overrides: {
        aud: { kind: "audio", uri: "/aud.mp3" },
        sub: { kind: "subtitle", uri: "/sub.srt" },
      },
    });
    useComposition.setState({ comp, selection: null });
    useDive.setState({ view: "lineage" });
    render(<DiveCanvas open={true} onClose={() => {}} />);

    const nodes = nodesOf();
    expect(nodes).toHaveLength(3);
    for (const n of nodes) {
      expect(
        minimapWouldRender(n),
        `node ${n.id} (${n.type}) has no minimap-renderable width/height`,
      ).toBe(true);
    }
  });

  it("folded unassigned bucket still carries a renderable dimension", () => {
    const comp = makeAssetGraph({ ids: ["img", "loose"] });
    comp.scenes = [makeScene({ id: "sc1", order: 0, memberAssetIds: ["img"] })];
    useComposition.setState({ comp, selection: null });
    // Collapse the unassigned bucket: it shrinks to a compact card. It must
    // still hand the minimap a dimension so the folded group draws a rect.
    useDive.setState({ unassignedCollapsed: true });
    render(<DiveCanvas open={true} onClose={() => {}} />);

    const folded = nodesOf().find((n) => n.id === "__unassigned__");
    expect(folded).toBeDefined();
    expect(minimapWouldRender(folded as Node)).toBe(true);
  });
});
