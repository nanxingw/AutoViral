import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoadErrorScreen } from "./LoadErrorScreen";

// #61 — the failure screen must show a human headline and tuck the raw server
// detail (ZodError JSON) into a collapsible panel, never as the headline.

const ZOD_DUMP =
  '[{"code":"invalid_union","path":["fps"],"message":"Invalid literal value, expected 24"}]';

describe("<LoadErrorScreen /> (#61)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the human headline, not the raw detail", () => {
    render(
      <LoadErrorScreen
        title="Failed to load"
        message="This work's composition data is incompatible or corrupted."
        detail={ZOD_DUMP}
        helpText="Inspect the file manually."
      />,
    );
    const headline = screen.getByText(/incompatible or corrupted/i);
    expect(headline).toBeInTheDocument();
    expect(headline.textContent).not.toContain("invalid_union");
  });

  it("puts the raw detail inside the collapsible technical-details panel", () => {
    render(
      <LoadErrorScreen title="Failed to load" message="Broken." detail={ZOD_DUMP} helpText="h" />,
    );
    const details = screen.getByTestId("loaderror-details");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(screen.getByTestId("loaderror-detail-pre").textContent).toContain("invalid_union");
  });

  it("omits the details panel entirely when there is no detail", () => {
    render(<LoadErrorScreen title="Failed to load" message="Network down." detail="" helpText="h" />);
    expect(screen.queryByTestId("loaderror-details")).toBeNull();
  });

  it("copies a diagnostic JSON blob containing the detail to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is a getter-only prop in jsdom — defineProperty, not assign.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <LoadErrorScreen title="Failed to load" message="Broken." detail={ZOD_DUMP} helpText="h" />,
    );
    fireEvent.click(screen.getByTestId("loaderror-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    // JSON.stringify escapes the quotes in the embedded detail, so assert on
    // quote-free tokens that survive escaping verbatim.
    expect(payload).toContain("invalid_union");
    expect(payload).toContain("fps");
    expect(payload).toContain("timestamp");
    // round-trips: the parsed payload's detail equals the original dump
    expect(JSON.parse(payload).detail).toBe(ZOD_DUMP);
    // status flips to "copied"
    await waitFor(() =>
      expect(screen.getByTestId("loaderror-copy").textContent).toMatch(/✓|copied/i),
    );
  });
});
