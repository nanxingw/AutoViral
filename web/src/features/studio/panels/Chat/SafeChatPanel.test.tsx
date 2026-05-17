import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// The current-branch ErrorBoundary's default fallback uses react-router's <Link>
// (introduced for F509 — see ErrorBoundary.tsx). Any test that triggers the
// default fallback (no `fallback` prop) must run inside a Router or the Link
// throws "Cannot destructure property 'basename' of useContext(...) as it is
// null". Custom-fallback tests don't need it but wrapping uniformly is cheap.
function renderInRouter(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

// We don't import SafeChatPanel directly — its dependencies (websocket /
// chatStore / markdown) drag heavy machinery into this lightweight test.
// Instead we exercise the same `fallback` prop pattern the wrapper uses,
// which is the unit of behaviour worth covering: ErrorBoundary's custom
// fallback renders + reset clears it.

function Boom(): ReactElement {
  throw new Error("chat-render-boom");
}

describe("SafeChatPanel pattern (Round 25 scoped boundary)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders a custom inline fallback instead of the default editorial screen", () => {
    renderInRouter(
      <ErrorBoundary
        fallback={(err) => (
          <div data-testid="compact-fallback">scoped: {err.message}</div>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );
    // Custom fallback wins — default editorial fallback (h1, link, etc.)
    // must NOT render.
    expect(screen.getByTestId("compact-fallback")).toHaveTextContent(
      "scoped: chat-render-boom",
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("falls back to the default editorial screen when no fallback prop is given", () => {
    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // The editorial default renders an h1 — this is the behavior R25's
    // optional fallback prop overrides.
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
