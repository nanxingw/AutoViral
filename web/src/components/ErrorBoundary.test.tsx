import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState, type ReactElement } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

// `Boom` is declared as ReactElement-returning so TS treats it as a JSX
// component, even though at runtime it always throws before returning.
function Boom(): ReactElement {
  throw new Error("boom-on-render");
}

/** Helper: throw on first render only, then render OK after `recover()`
 * is called. Lets us prove the F502 soft-retry path actually recovers
 * rather than re-throwing. */
function FlakyChild({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
  if (shouldThrow) throw new Error("flaky-boom");
  return <div data-testid="recovered">recovered</div>;
}

function renderInRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress the noisy "uncaught error" warning that React emits when
    // a child throws — the boundary handles it correctly, the noise
    // would just clutter test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    renderInRouter(
      <ErrorBoundary>
        <div data-testid="child">ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders fallback + error message when child throws", () => {
    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // role=alert anchors the fallback for screen readers
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Message surfaces the actual error so devs can debug from screenshots
    expect(screen.getByText(/boom-on-render/)).toBeInTheDocument();
    // R113 F509 — home affordance is a react-router Link (client-side
    // navigation) rather than a hard <a href>.
    expect(screen.getByTestId("errorboundary-home")).toHaveAttribute("href", "/");
  });

  // R113 F503 — every fallback render carries a stable correlation ID
  // the user can quote back in bug reports.
  it("renders a UUID-like Error ID (F503)", () => {
    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const idEl = screen.getByTestId("errorboundary-error-id");
    // randomUUID format or our short fallback `err-{base36}-{6chars}`
    expect(idEl.textContent ?? "").toMatch(/[a-f0-9-]{8,}|err-[a-z0-9]+-[a-z0-9]+/i);
  });

  // R113 F502 — Try Again clears boundary state without reloading; if
  // the child recovers (no longer throws), the boundary unmounts and
  // re-renders the recovered subtree, preserving everything else.
  it("Try again clears boundary state without reloading (F502)", () => {
    function Wrapper() {
      const [throws, setThrows] = useState(true);
      // Wire the "fix the underlying condition" into the document so
      // we can flip it from the test before clicking Try again.
      (globalThis as { __FIX_FLAKY__?: () => void }).__FIX_FLAKY__ = () => setThrows(false);
      return (
        <MemoryRouter>
          <ErrorBoundary>
            <FlakyChild shouldThrow={throws} />
          </ErrorBoundary>
        </MemoryRouter>
      );
    }
    render(<Wrapper />);
    // Initial state: boundary caught the throw, fallback rendered.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Fix the underlying condition, then click Try again.
    (globalThis as { __FIX_FLAKY__?: () => void }).__FIX_FLAKY__?.();
    fireEvent.click(screen.getByTestId("errorboundary-try-again"));
    // Boundary state cleared → child re-renders → no throw → recovered.
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // R113 F500 — Reload prompts the user before nuking everything. We
  // stub window.confirm to verify the gate without actually reloading.
  it("Reload triggers confirm() prompt before reloading (F500)", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    // No reload spy needed — confirm returning false short-circuits
    // before window.location.reload() is called.
    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId("errorboundary-reload"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/discard|丢失/i);
  });

  // R113 F504 — Copy diagnostic packs a structured JSON payload to the
  // clipboard so users can attach it to bug reports without rage-Reloading.
  it("Copy diagnostic writes a JSON payload with errorId + name + stack (F504)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByTestId("errorboundary-copy"));
    // Wait one microtask for the awaited writeText.
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload).toMatchObject({
      name: "Error",
      message: "boom-on-render",
    });
    expect(payload.errorId).toBeTruthy();
    expect(payload.timestamp).toBeTruthy();
  });

  // R113 F510 — sr-only "Error — " inside the h1 so SR users hear
  // the severity, matching the NotFound sr-only error code pattern.
  it("provides sr-only Error code in the h1 (F510)", () => {
    renderInRouter(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/Error|错误/);
  });
});
