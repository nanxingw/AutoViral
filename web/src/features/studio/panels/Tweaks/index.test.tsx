import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TweaksPanel } from "./index";
import { useTheme } from "@/stores/theme";

beforeEach(() => useTheme.setState({ theme: "dark" }));

describe("TweaksPanel (v4 floating overlay)", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(<TweaksPanel open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the Theme section (no Layer/Composition/Density)", () => {
    render(<TweaksPanel open={true} />);
    expect(screen.getByText(/Theme/i)).toBeTruthy();
    expect(screen.queryByTestId("layer-brightness")).toBeNull();
    expect(screen.queryByText(/Composition/i)).toBeNull();
    expect(screen.queryByText(/Density/i)).toBeNull();
  });

  it("is positioned as a fixed-position floating overlay", () => {
    const { container } = render(<TweaksPanel open={true} />);
    const root = container.firstChild as HTMLElement;
    expect(getComputedStyle(root).position).toBe("fixed");
  });

  it("theme toggle button writes through to useTheme store", () => {
    render(<TweaksPanel open={true} />);
    const lightBtn = screen.getByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
