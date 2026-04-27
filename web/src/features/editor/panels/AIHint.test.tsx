import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AIHint } from "./AIHint";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";
import type { Layer } from "../types";

describe("AIHint", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("renders nothing when no carousel", () => {
    const { container } = render(<AIHint />);
    expect(container.firstChild).toBeNull();
  });

  it("flags the first low-density slide", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<AIHint />);
    expect(screen.getByText(/第 1 张密度低/)).toBeInTheDocument();
  });

  it("disappears once every slide has 2+ layers", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const mk = (id: string): Layer => ({
      id,
      kind: "text",
      box: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      text: "x",
      style: {
        font: "sans",
        size: 12,
        weight: 400,
        italic: false,
        color: "#000",
        align: "left",
        tracking: 0,
      },
    });
    useEditor.getState().addLayer(mk("a"));
    useEditor.getState().addLayer(mk("b"));
    const { container } = render(<AIHint />);
    expect(container.firstChild).toBeNull();
  });
});
