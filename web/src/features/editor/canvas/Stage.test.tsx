import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

// Mock react-konva primitives to plain divs — happy-dom can't run a real
// Konva canvas. We assert the layer tree composes correctly via data attrs.
vi.mock("react-konva", () => {
  const passthrough =
    (kind: string) =>
    ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(
        "div",
        { "data-kind": kind, ...rest },
        children as React.ReactNode,
      );
  return {
    Stage: passthrough("stage"),
    Layer: passthrough("layer"),
    Rect: passthrough("rect"),
    Circle: passthrough("circle"),
    Line: passthrough("line"),
    Text: passthrough("text"),
    Image: passthrough("image"),
    Transformer: passthrough("transformer"),
  };
});
vi.mock("use-image", () => ({ default: () => [undefined, "loaded"] }));

import { Stage } from "./Stage";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

describe("Stage", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("renders nothing when no carousel loaded", () => {
    const { container } = render(<Stage />);
    expect(container.querySelector('[data-kind="stage"]')).toBeNull();
  });

  it("renders stage + background for current slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const { container } = render(<Stage />);
    expect(container.querySelector('[data-kind="stage"]')).toBeTruthy();
    expect(container.querySelector('[data-kind="layer"]')).toBeTruthy();
    expect(container.querySelector('[data-kind="rect"]')).toBeTruthy();
  });

  it("renders text layer nodes for text layers on the current slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addLayer({
      id: "t1",
      kind: "text",
      box: { x: 0, y: 0, w: 200, h: 40, rotation: 0 },
      text: "Hello",
      style: {
        font: "sans",
        size: 24,
        weight: 400,
        italic: false,
        color: "#000",
        align: "left",
        tracking: 0,
      },
    });
    const { container } = render(<Stage />);
    expect(container.querySelector('[data-kind="text"]')).toBeTruthy();
  });
});
