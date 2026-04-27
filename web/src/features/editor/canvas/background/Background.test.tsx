import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { parseGradientStops } from "./Background";

// react-konva needs a real <canvas> + Konva, which happy-dom can't drive
// reliably in unit tests. Mock the few primitives we use to plain divs so we
// can assert prop wiring without booting Konva.
vi.mock("react-konva", () => ({
  Rect: (props: Record<string, unknown>) =>
    React.createElement("div", { "data-kind": "rect", ...props }),
  Image: (props: Record<string, unknown>) =>
    React.createElement("div", { "data-kind": "image", ...props }),
}));
vi.mock("use-image", () => ({ default: () => [undefined, "loaded"] }));

import { Background } from "./Background";

describe("Background", () => {
  it("solid renders a rect with the fill color", () => {
    const { container } = render(
      <Background
        bg={{ type: "solid", value: "#ff0000" }}
        width={100}
        height={100}
      />,
    );
    const rect = container.querySelector('[data-kind="rect"]');
    expect(rect?.getAttribute("fill")).toBe("#ff0000");
  });

  it("gradient renders a rect with two color stops", () => {
    const { container } = render(
      <Background
        bg={{
          type: "gradient",
          value: "linear-gradient(135deg, #112233 0%, #445566 100%)",
        }}
        width={50}
        height={80}
      />,
    );
    const rect = container.querySelector('[data-kind="rect"]');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute("filllineargradientcolorstops")).toBeTruthy();
  });

  it("image renders an Image node bound to the src", () => {
    const { container } = render(
      <Background
        bg={{ type: "image", value: "/photo.png" }}
        width={50}
        height={80}
      />,
    );
    expect(container.querySelector('[data-kind="image"]')).toBeTruthy();
  });
});

describe("parseGradientStops", () => {
  it("extracts first and last hex from a linear-gradient string", () => {
    expect(
      parseGradientStops("linear-gradient(90deg, #aabbcc 0%, #112233 100%)"),
    ).toEqual(["#aabbcc", "#112233"]);
  });

  it("falls back to neutral when no colors present", () => {
    expect(parseGradientStops("foo")).toEqual(["#fafaf7", "#e8e6df"]);
  });

  it("duplicates a single stop", () => {
    expect(parseGradientStops("solid #aabbcc thing")).toEqual([
      "#aabbcc",
      "#aabbcc",
    ]);
  });
});
