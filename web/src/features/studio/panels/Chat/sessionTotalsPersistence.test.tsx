import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SessionTotals } from "./index";
import { seedBlocksFromHistory } from "@/features/chat/seed";
import type { StreamBlock } from "@/features/chat/types";

// PRD-0010 B3 — the session cost total must SURVIVE a refresh.
//
// The bug: turn_complete folds a turn's cost into the last text block LIVE, but
// the WS `message_history` reseed on reload/reconnect mapped only a subset of
// fields and DROPPED `usage`. So a refresh re-seeded usage-less blocks and
// SessionTotals recomputed to $0.000 — the running total "reset to zero".
//
// Path 1 (HTTP /api/works/:id/chat) already spread `...b`, so it kept usage once
// the server persisted it (B3 server side). This file locks the WS reseed path:
// seedBlocksFromHistory must carry `usage` through so the badge is identical
// before and after a refresh.

describe("B3 — seedBlocksFromHistory carries persisted usage", () => {
  it("preserves the usage object on a text block through the message_history reseed", () => {
    const raw = [
      { id: "s_1:0", type: "user", text: "hi", timestamp: "2026-07-02T00:00:00.000Z" },
      {
        id: "s_1:1",
        type: "text",
        text: "reply",
        timestamp: "2026-07-02T00:00:01.000Z",
        usage: { costUsd: 0.1, durationMs: 1234, inputTokens: 100, outputTokens: 50 },
      },
    ];
    const seeded = seedBlocksFromHistory(raw);
    const textBlock = seeded.find((b) => b.type === "text");
    expect(textBlock?.usage).toEqual({
      costUsd: 0.1,
      durationMs: 1234,
      inputTokens: 100,
      outputTokens: 50,
    });
    // Blocks without usage stay usage-less (no phantom zero badge).
    expect(seeded.find((b) => b.type === "user")?.usage).toBeUndefined();
  });
});

describe("B3 — SessionTotals is identical before and after a refresh", () => {
  it("re-seeding the persisted history yields the SAME non-zero session total", () => {
    // Pre-refresh: what the LIVE store holds after turn_complete →
    // attachLastTurnUsage stamped the last text block.
    const live: StreamBlock[] = [
      { id: "s_1:0", ts: 1, type: "user", text: "hi" },
      {
        id: "s_1:1",
        ts: 2,
        type: "text",
        text: "reply",
        usage: { costUsd: 0.1, durationMs: 1234, inputTokens: 100, outputTokens: 50 },
      },
    ];
    const before = render(<SessionTotals blocks={live} />);
    const beforeText = before.container.textContent ?? "";
    // Sanity: the live badge is a real non-zero total.
    expect(beforeText).toContain("$0.100");
    expect(beforeText).not.toContain("$0.000");

    // Refresh: the WS message_history frame replays the PERSISTED blocks (server
    // stamped + persisted the same usage). Re-seed them exactly as useChatSocket
    // does on reconnect.
    const persistedRaw = [
      { id: "s_1:0", type: "user", text: "hi", timestamp: "2026-07-02T00:00:00.000Z" },
      {
        id: "s_1:1",
        type: "text",
        text: "reply",
        timestamp: "2026-07-02T00:00:01.000Z",
        usage: { costUsd: 0.1, durationMs: 1234, inputTokens: 100, outputTokens: 50 },
      },
    ];
    const after = render(<SessionTotals blocks={seedBlocksFromHistory(persistedRaw)} />);
    const afterText = after.container.textContent ?? "";

    expect(afterText).toBe(beforeText); // survives refresh — no reset to zero
    expect(afterText).toContain("$0.100");
  });
});
