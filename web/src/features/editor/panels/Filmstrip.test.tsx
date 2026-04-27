import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Filmstrip } from "./Filmstrip";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

describe("Filmstrip", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("renders one thumb per slide", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    useEditor.getState().addSlide();
    useEditor.getState().addSlide();
    const { container } = render(<Filmstrip />);
    expect(container.querySelectorAll("[data-slide-id]")).toHaveLength(3);
  });

  it("clicking a thumb sets currentSlideId", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    useEditor.getState().addSlide();
    const ids = useEditor.getState().car!.slides.map((s) => s.id);
    const { container } = render(<Filmstrip />);
    const target = container.querySelector(
      `[data-slide-id="${ids[0]}"]`,
    ) as HTMLElement;
    fireEvent.click(target);
    expect(useEditor.getState().currentSlideId).toBe(ids[0]);
  });

  it("shows DRAG TO REORDER microcopy", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<Filmstrip />);
    expect(screen.getByText(/Drag to reorder/i)).toBeInTheDocument();
  });
});
