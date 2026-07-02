import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageBadge, SessionTotals } from "../index";
import type { StreamBlock, TurnUsage } from "@/features/chat/types";

// C4 (PRD-0010) — codex usage badges are TOKEN-ONLY (no $): codex reports token
// usage but no per-turn USD, and we refuse to guess a local price. A claude
// badge keeps its `$cost` chip. Both the per-turn UsageBadge and the header
// SessionTotals must honor the session backend.

const usage: TurnUsage = {
  costUsd: 0.1234,
  durationMs: 5000,
  inputTokens: 1200,
  outputTokens: 800,
};

function block(u: TurnUsage): StreamBlock {
  return { id: "b1", type: "text", text: "hi", ts: 0, usage: u };
}

describe("UsageBadge — per-turn backend-aware cost (C4)", () => {
  it("claude turn shows the $ cost chip", () => {
    render(<UsageBadge usage={usage} backend="claude" />);
    expect(screen.getByText(/\$0\.1234/)).toBeInTheDocument();
  });

  it("codex turn omits the $ cost chip but keeps tokens", () => {
    const { container } = render(<UsageBadge usage={usage} backend="codex" />);
    expect(container.textContent).not.toMatch(/\$/);
    // tokens still render (1.2k→0.8k tok)
    expect(container.textContent).toMatch(/tok/);
  });

  it("defaults to claude ($ shown) when no backend prop is passed", () => {
    render(<UsageBadge usage={usage} />);
    expect(screen.getByText(/\$0\.1234/)).toBeInTheDocument();
  });
});

describe("SessionTotals — header running total backend-aware (C4)", () => {
  it("claude session shows Σ $cost · tokens", () => {
    const { container } = render(<SessionTotals blocks={[block(usage)]} backend="claude" />);
    expect(container.textContent).toMatch(/\$/);
    expect(container.textContent).toMatch(/Σ/);
  });

  it("codex session shows tokens only, no $", () => {
    const { container } = render(<SessionTotals blocks={[block(usage)]} backend="codex" />);
    expect(container.textContent).not.toMatch(/\$/);
    // still renders the token count so the badge isn't blank on a codex turn
    expect(container.textContent).toMatch(/Σ/);
  });
});
