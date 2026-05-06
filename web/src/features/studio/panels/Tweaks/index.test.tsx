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

  // Phase 6.D — section is gated on `workId` so existing tests that omit it
  // continue to render the Theme section only.
  it("mounts PlatformPresetSection when workId is provided", () => {
    render(<TweaksPanel open={true} workId="w_test" />);
    expect(screen.getByLabelText(/platform preset/i)).toBeInTheDocument();
  });

  it("does NOT mount PlatformPresetSection when workId is omitted", () => {
    render(<TweaksPanel open={true} />);
    expect(screen.queryByLabelText(/platform preset/i)).not.toBeInTheDocument();
  });
});
