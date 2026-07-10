import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { IconButton } from "./IconButton";

// A throwaway inline SVG standing in for a real icon child.
function Glyph() {
  return (
    <svg viewBox="0 0 24 24" data-testid="glyph">
      <path d="M6 6l12 12" />
    </svg>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("<IconButton />", () => {
  it("defaults to type=button (never submits an ancestor form)", () => {
    render(
      <IconButton aria-label="close">
        <Glyph />
      </IconButton>,
    );
    expect(screen.getByLabelText("close").getAttribute("type")).toBe("button");
  });

  it("forwards ref, onClick, disabled and title", () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="act" ref={ref} onClick={onClick} disabled title="Do it">
        <Glyph />
      </IconButton>,
    );
    const btn = screen.getByLabelText("act");
    expect(ref.current).toBe(btn);
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toBe("Do it");
    // disabled buttons don't dispatch click — enable via a second render.
    render(
      <IconButton aria-label="act2" onClick={onClick}>
        <Glyph />
      </IconButton>,
    );
    fireEvent.click(screen.getByLabelText("act2"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("carries both structural markers: data-bare (pill opt-out) + data-icon-button", () => {
    render(
      <IconButton aria-label="mark">
        <Glyph />
      </IconButton>,
    );
    const btn = screen.getByLabelText("mark");
    expect(btn).toHaveAttribute("data-bare");
    expect(btn).toHaveAttribute("data-icon-button");
  });

  it("wraps the icon child in an aria-hidden wrapper that still contains the SVG", () => {
    render(
      <IconButton aria-label="icon">
        <Glyph />
      </IconButton>,
    );
    const btn = screen.getByLabelText("icon");
    const wrapper = btn.querySelector("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("svg")).not.toBeNull();
  });

  it("warns in dev when no accessible name is supplied", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <IconButton>
        <Glyph />
      </IconButton>,
    );
    expect(warn).toHaveBeenCalled();
  });

  it("does NOT warn when aria-labelledby is supplied instead of aria-label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <span id="lbl">Close</span>
        <IconButton aria-labelledby="lbl">
          <Glyph />
        </IconButton>
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("applies size and variant classes for every documented branch", () => {
    for (const size of ["compact", "sm", "md", "lg"] as const) {
      const { unmount } = render(
        <IconButton aria-label={`s-${size}`} size={size}>
          <Glyph />
        </IconButton>,
      );
      const btn = screen.getByLabelText(`s-${size}`);
      // The class list must gain a size-specific class beyond the base one.
      expect(btn.className.split(/\s+/).length).toBeGreaterThan(1);
      unmount();
    }
    for (const variant of ["ghost", "surface", "danger"] as const) {
      const { unmount } = render(
        <IconButton aria-label={`v-${variant}`} variant={variant}>
          <Glyph />
        </IconButton>,
      );
      const btn = screen.getByLabelText(`v-${variant}`);
      expect(btn.className.split(/\s+/).length).toBeGreaterThan(1);
      unmount();
    }
  });

  it("merges an external className without dropping the structural markers", () => {
    render(
      <IconButton aria-label="merge" className="my-extra">
        <Glyph />
      </IconButton>,
    );
    const btn = screen.getByLabelText("merge");
    expect(btn.className).toContain("my-extra");
    // Markers survive regardless of caller className.
    expect(btn).toHaveAttribute("data-icon-button");
  });
});
