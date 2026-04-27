import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlidesNav } from "./SlidesNav";
import { useEditor } from "../store";
import { makeEmptyCarousel } from "../types";

describe("SlidesNav", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("renders slide rows + add button", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    render(<SlidesNav />);
    expect(screen.getByText(/Slides · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Add slide/i)).toBeInTheDocument();
  });

  it("clicking + Add slide grows the slide list", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    render(<SlidesNav />);
    fireEvent.click(screen.getByText(/Add slide/i));
    expect(useEditor.getState().car!.slides).toHaveLength(2);
  });

  it("dup button duplicates a slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    render(<SlidesNav />);
    fireEvent.click(screen.getByText("dup"));
    expect(useEditor.getState().car!.slides).toHaveLength(2);
  });

  it("del is disabled when only one slide remains", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    render(<SlidesNav />);
    const del = screen.getByText("del") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });
});
