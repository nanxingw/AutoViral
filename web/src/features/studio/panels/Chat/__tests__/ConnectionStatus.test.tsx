import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConnectionStatus } from "../ConnectionStatus";
import type { WSState } from "@/lib/ws";

// Persistent connection indicator: success now has a steady green confirmation,
// symmetric with the red failure badge. Setup forces the "en" locale.

function dot(container: HTMLElement) {
  return container.querySelector('[data-testid="chat-connection-status"] span[aria-hidden="true"]') as HTMLElement;
}

describe("ConnectionStatus", () => {
  it("open → steady green dot (no pulse) + CONNECTED label", () => {
    const { container } = render(<ConnectionStatus state={"open"} />);
    const badge = screen.getByTestId("chat-connection-status");
    expect(badge.dataset.state).toBe("open");
    expect(badge.textContent).toMatch(/CONNECTED/i);
    const d = dot(container);
    expect(d.style.background).toContain("--status-done"); // green/success token
    expect(d.className).not.toContain("pulse-dot"); // stable = no motion
    cleanup();
  });

  it("connecting → amber pulsing dot + CONNECTING label", () => {
    const { container } = render(<ConnectionStatus state={"connecting"} />);
    const badge = screen.getByTestId("chat-connection-status");
    expect(badge.dataset.state).toBe("connecting");
    expect(badge.textContent).toMatch(/CONNECTING/i);
    const d = dot(container);
    expect(d.style.background).toContain("--status-warn");
    expect(d.className).toContain("pulse-dot");
    cleanup();
  });

  it("reconnecting → red pulsing dot + RECONNECTING label", () => {
    const { container } = render(<ConnectionStatus state={"reconnecting"} />);
    const badge = screen.getByTestId("chat-connection-status");
    expect(badge.dataset.state).toBe("reconnecting");
    expect(badge.textContent).toMatch(/RECONNECTING/i);
    const d = dot(container);
    expect(d.style.background).toContain("--status-error");
    expect(d.className).toContain("pulse-dot");
    cleanup();
  });

  it("renders in EVERY WSState (no missing-state crash)", () => {
    for (const s of ["connecting", "open", "reconnecting"] as WSState[]) {
      const { container } = render(<ConnectionStatus state={s} />);
      expect(container.querySelector('[data-testid="chat-connection-status"]')).toBeTruthy();
      cleanup();
    }
  });
});
