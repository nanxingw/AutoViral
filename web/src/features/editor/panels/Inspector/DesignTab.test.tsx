import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { DesignTab } from "./DesignTab";
import { useEditor } from "../../store";
import { makeEmptyCarousel } from "../../types";

describe("DesignTab", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("clicking a palette chip updates globals.palette", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<DesignTab />);
    fireEvent.click(screen.getByText("Noir"));
    expect(useEditor.getState().car!.globals.palette).toBe("noir");
  });

  it("clicking the Sans font chip updates headlineFont", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<DesignTab />);
    fireEvent.click(screen.getByText("Sans"));
    expect(useEditor.getState().car!.globals.headlineFont).toBe("sans");
  });

  it("dragging the grain slider updates effects.grain", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<DesignTab />);
    fireEvent.change(screen.getByLabelText("grain"), { target: { value: "0.5" } });
    expect(useEditor.getState().car!.globals.effects.grain).toBeCloseTo(0.5);
  });

  // #70 — the sharpen slider was a deceptive dead control (no renderer
  // consumed effects.sharpen). It was removed; only grain + gradient remain.
  // Pins the removal so a future edit can't silently bring the fake control
  // back without also wiring a real sharpen render path.
  it("does NOT render a sharpen slider (#70 — removed dead control)", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<DesignTab />);
    expect(screen.getByLabelText("grain")).toBeInTheDocument();
    expect(screen.getByLabelText("gradient")).toBeInTheDocument();
    expect(screen.queryByLabelText("sharpen")).toBeNull();
    expect(screen.queryByLabelText("锐化")).toBeNull();
  });
});
