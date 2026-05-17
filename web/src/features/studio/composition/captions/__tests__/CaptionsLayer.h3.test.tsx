/**
 * H3 — caption highlight animation type tests.
 *
 * We don't mount the full Remotion <Sequence> tree; we just render the
 * CaptionWord-equivalent state by exercising the public CaptionsLayer
 * component with a fixture model and asserting that the active word's
 * DOM carries the expected data-attributes and child effect elements.
 *
 * H3.1: marker-sweep + scribble
 * H3.2: burst + slam
 * H3.3: elastic + clip-reveal
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Stub Remotion's useCurrentFrame so the layer thinks we're at a specific frame.
vi.mock("remotion", () => ({
  useCurrentFrame: () => 30, // 1.0s @ 30fps — inside the only group's window
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920 }),
  AbsoluteFill: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
}));

import { CaptionsLayer } from "../CaptionsLayer";
import type { CaptionModel } from "@/features/studio/types";

function fixtureWithHighlight(
  type: string,
  extra: Record<string, unknown> = {},
): CaptionModel {
  return {
    modelId: "m1",
    audioTrackId: null,
    segments: [
      { segmentId: "seg_1", start: 0, end: 2, text: "Hello" },
    ],
    groups: [
      {
        groupId: "g1",
        start: 0,
        end: 2,
        segmentIds: ["seg_1"],
        style: {
          fontSize: 56,
          color: "#fff",
          background: "rgba(0,0,0,0.5)",
          padding: "4px 8px",
          borderRadius: 4,
          textAlign: "center",
          bottomOffsetPx: 120,
        },
        animation: {
          highlight: {
            activeColor: "#a8c5d6",
            dimColor: "#888",
            type,
            ...extra,
          },
        },
      },
    ],
  } as unknown as CaptionModel;
}

describe("CaptionsLayer · H3 highlight types", () => {
  it("marker-sweep (H3.1): active word carries data-effect='marker-sweep'", () => {
    const { container } = render(
      <CaptionsLayer model={fixtureWithHighlight("marker-sweep")} />,
    );
    expect(container.querySelector('[data-effect="marker-sweep"]')).toBeTruthy();
  });

  it("scribble underline (H3.1): renders an SVG with data-effect='scribble-underline'", () => {
    const { container } = render(
      <CaptionsLayer
        model={fixtureWithHighlight("scribble", { scribblePath: "underline" })}
      />,
    );
    expect(
      container.querySelector('[data-effect="scribble-underline"]'),
    ).toBeTruthy();
  });

  it("scribble circle: data-effect='scribble-circle'", () => {
    const { container } = render(
      <CaptionsLayer
        model={fixtureWithHighlight("scribble", { scribblePath: "circle" })}
      />,
    );
    expect(
      container.querySelector('[data-effect="scribble-circle"]'),
    ).toBeTruthy();
  });

  it("burst (H3.2): renders data-effect='burst' with N child lines", () => {
    const { container } = render(
      <CaptionsLayer
        model={fixtureWithHighlight("burst", { burstLineCount: 8 })}
      />,
    );
    const burst = container.querySelector('[data-effect="burst"]');
    expect(burst).toBeTruthy();
    // Each radial line is one direct child span inside the burst container.
    expect(burst?.children.length).toBe(8);
  });

  it("slam (H3.2): active word transform contains scale(1.4)", () => {
    const { container } = render(
      <CaptionsLayer
        model={fixtureWithHighlight("slam", { slamScale: 1.4 })}
      />,
    );
    const active = container.querySelector(
      '[data-active="true"][data-highlight-type="slam"]',
    ) as HTMLElement | null;
    expect(active).toBeTruthy();
    expect(active?.style.transform).toContain("scale(1.4)");
  });

  it("elastic (H3.3): transform contains scale 1+overshoot", () => {
    const { container } = render(
      <CaptionsLayer
        model={fixtureWithHighlight("elastic", { elasticOvershoot: 0.25 })}
      />,
    );
    const active = container.querySelector(
      '[data-active="true"][data-highlight-type="elastic"]',
    ) as HTMLElement | null;
    expect(active).toBeTruthy();
    expect(active?.style.transform).toContain("scale(1.25)");
  });

  it("clip-reveal (H3.3): active word has clip-path inline style", () => {
    const { container } = render(
      <CaptionsLayer model={fixtureWithHighlight("clip-reveal")} />,
    );
    const active = container.querySelector(
      '[data-active="true"][data-highlight-type="clip-reveal"]',
    ) as HTMLElement | null;
    expect(active).toBeTruthy();
    expect(active?.style.clipPath).toBeTruthy();
  });

  it("basic-color (default fallback): no extra effect elements", () => {
    const { container } = render(
      <CaptionsLayer model={fixtureWithHighlight("basic-color")} />,
    );
    expect(container.querySelector('[data-effect]')).toBeFalsy();
  });
});
