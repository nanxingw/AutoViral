import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Same testing rationale as SafeChatPanel.test.tsx (R25): we exercise
// the fallback prop pattern itself rather than dragging the heavy
// Timeline machinery (zustand store + waveform decode + react-konva)
// into a unit test. Mounting the real Timeline through SafeTimeline
// works; testing the contract — boundary intercepts crash, custom
// fallback renders — is the unit worth covering here.

function Boom(): ReactElement {
  throw new Error("timeline-clip-deserialize-boom");
}

describe("SafeTimeline pattern (Round 30 scoped boundary)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders a custom inline fallback for timeline crashes", () => {
    render(
      <ErrorBoundary
        fallback={(err) => (
          <div data-testid="timeline-fallback" role="alert">
            {err.message}
          </div>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("timeline-fallback")).toHaveTextContent(
      "timeline-clip-deserialize-boom",
    );
    // Default editorial fallback (h1) must NOT render — scoped fallback
    // takes over.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
