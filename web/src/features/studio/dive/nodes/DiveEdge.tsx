import { getBezierPath, type EdgeProps } from "@xyflow/react";

// Item 3 (Dive premium upgrade) — provenance edges as a "three-piece" custom
// edge, transplanted from the reference infinite-canvas ConnectionPath and
// re-tokenised to AutoViral cool-steel:
//
//   1. a bezier curve (getBezierPath — the lane-based horizontal layout reads
//      cleaner with a curve than the prior smoothstep);
//   2. a DOUBLE path — an invisible strokeWidth:16 hit target UNDER a 1.5px
//      visible line, so the whole edge is easy to hover/click without fattening
//      what you see;
//   3. hover / selected accent + glow, and an optional marching-ants dash flow
//      while `data.generating` (a derivation is still rendering upstream).
//
// The arrowhead marker rides `markerEnd` (a `url(#…)` xyflow computes from
// DiveCanvas's defaultEdgeOptions.markerEnd — its COLOUR is baked there because
// xyflow paints the marker as an inline style that beats any stylesheet). All
// stroke colours + the dash animation live in dive.css under `.dive-edge-*`
// (reduced-motion drops the animation there).

interface DiveEdgeData extends Record<string, unknown> {
  /** A source asset is still generating → animate the edge as marching ants. */
  generating?: boolean;
}

export function DiveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const generating = Boolean((data as DiveEdgeData | undefined)?.generating);
  const lineClass = [
    "dive-edge-line",
    selected ? "selected" : "",
    generating ? "generating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {/* (2) wide invisible hit target — easy to grab, never seen. */}
      <path
        data-testid={`dive-edge-hit-${id}`}
        className="dive-edge-hit"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: "stroke" }}
      />
      {/* (2) the visible line, hovered via the hit path's sibling selector. */}
      <path
        id={id}
        data-testid={`dive-edge-line-${id}`}
        data-generating={generating ? "true" : undefined}
        className={lineClass}
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
        style={{ pointerEvents: "none" }}
      />
    </>
  );
}
