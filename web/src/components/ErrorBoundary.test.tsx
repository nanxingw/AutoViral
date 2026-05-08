import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

// `Boom` is declared as ReactElement-returning so TS treats it as a JSX
// component, even though at runtime it always throws before returning.
function Boom(): ReactElement {
  throw new Error("boom-on-render");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress the noisy "uncaught error" jsdom warning that React emits
    // when a child throws — the boundary handles it correctly, the noise
    // would just clutter test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders fallback + error message when child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // role=alert anchors the fallback for screen readers
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Message surfaces the actual error so devs can debug from screenshots
    expect(screen.getByText(/boom-on-render/)).toBeInTheDocument();
    // Recovery affordances both present
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /works/i })).toHaveAttribute("href", "/");
  });
});
