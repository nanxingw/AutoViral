import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import { DiveEdge } from "./DiveEdge";

// Item 3 — the "three-piece" provenance edge contract. getBezierPath is pure so
// this renders happily without a ReactFlow provider; we mount the edge inside a
// bare <svg> and assert the double-path structure + state classes. Physical
// hover/click reachability is browser-only (CSS `:hover` sibling selector);
// here we lock the DOM the fix must produce.

function edgeProps(over: Partial<EdgeProps> = {}): EdgeProps {
  return {
    id: "e1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 120,
    targetY: 80,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    markerEnd: "url(#arrow)",
    selected: false,
    ...over,
  } as EdgeProps;
}

function renderEdge(props: EdgeProps) {
  return render(
    <svg>
      <DiveEdge {...props} />
    </svg>,
  );
}

describe("DiveEdge — three-piece provenance edge (Item 3)", () => {
  it("renders a wide invisible hit path UNDER a thin visible line, sharing one d", () => {
    const { container } = renderEdge(edgeProps());
    const hit = container.querySelector<SVGPathElement>('[data-testid="dive-edge-hit-e1"]');
    const line = container.querySelector<SVGPathElement>('[data-testid="dive-edge-line-e1"]');
    expect(hit).not.toBeNull();
    expect(line).not.toBeNull();
    // Wide transparent hit target so the whole curve is grabbable.
    expect(hit!.getAttribute("stroke-width")).toBe("16");
    expect(hit!.getAttribute("stroke")).toBe("transparent");
    // The two paths trace the SAME bezier curve.
    expect(hit!.getAttribute("d")).toBe(line!.getAttribute("d"));
    // A non-empty bezier path (C command) — proves getBezierPath produced a curve.
    expect(line!.getAttribute("d") ?? "").toContain("C");
    // The hit path precedes the visible line so `.dive-edge-hit:hover + .dive-edge-line`
    // resolves (sibling combinator needs the hit target first in source order).
    expect(hit!.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("forwards the arrowhead marker onto the VISIBLE line only", () => {
    const { container } = renderEdge(edgeProps());
    const line = container.querySelector<SVGPathElement>('[data-testid="dive-edge-line-e1"]');
    const hit = container.querySelector<SVGPathElement>('[data-testid="dive-edge-hit-e1"]');
    expect(line!.getAttribute("marker-end")).toBe("url(#arrow)");
    expect(hit!.getAttribute("marker-end")).toBeNull();
  });

  it("adds the `selected` class when the edge is selected", () => {
    const { container } = renderEdge(edgeProps({ selected: true }));
    const line = container.querySelector<SVGPathElement>('[data-testid="dive-edge-line-e1"]');
    expect(line!.classList.contains("selected")).toBe(true);
  });

  it("flags marching-ants (generating) from edge data", () => {
    const { container } = renderEdge(edgeProps({ data: { generating: true } } as Partial<EdgeProps>));
    const line = container.querySelector<SVGPathElement>('[data-testid="dive-edge-line-e1"]');
    expect(line!.classList.contains("generating")).toBe(true);
    expect(line!.getAttribute("data-generating")).toBe("true");
  });

  it("no generating class when data is absent or false", () => {
    const { container } = renderEdge(edgeProps());
    const line = container.querySelector<SVGPathElement>('[data-testid="dive-edge-line-e1"]');
    expect(line!.classList.contains("generating")).toBe(false);
  });
});
