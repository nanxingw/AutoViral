import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TweaksPanel } from "./index";
import { useTheme } from "@/stores/theme";

beforeEach(() => useTheme.setState({ theme: "dark" }));

describe("TweaksPanel (v4 floating overlay)", () => {
  it("renders only the Theme section (no Layer/Composition/Density)", () => {
    render(<TweaksPanel />);
    expect(screen.getByText(/Theme/i)).toBeTruthy();
    expect(screen.queryByTestId("layer-brightness")).toBeNull();
    expect(screen.queryByText(/Composition/i)).toBeNull();
    expect(screen.queryByText(/Density/i)).toBeNull();
  });

  it("is positioned as a fixed-position floating overlay", () => {
    const { container } = render(<TweaksPanel />);
    const root = container.firstChild as HTMLElement;
    expect(getComputedStyle(root).position).toBe("fixed");
  });

  it("theme toggle button writes through to useTheme store", () => {
    render(<TweaksPanel />);
    const lightBtn = screen.getByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
