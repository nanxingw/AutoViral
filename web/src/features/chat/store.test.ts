import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./store";
import type { StreamBlock } from "./types";

describe("chat store", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("appends user blocks", () => {
    useChatStore.getState().push({ type: "user", text: "hi" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    expect(useChatStore.getState().blocks[0].type).toBe("user");
  });

  it("toggles streaming flag", () => {
    useChatStore.getState().setStreaming(true);
    expect(useChatStore.getState().streaming).toBe(true);
  });
});

describe("useChatStore.setBlocks", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("replaces the entire blocks array", () => {
    useChatStore.getState().push({ type: "user", text: "old" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    const seeded: StreamBlock[] = [
      { id: "h1", ts: 1, type: "user", text: "seeded-1" },
      { id: "h2", ts: 2, type: "text", text: "seeded-2" },
    ];
    useChatStore.getState().setBlocks(seeded);
    expect(useChatStore.getState().blocks).toEqual(seeded);
  });
});

// PRD-0010 A1 — with server-assigned stable ids, the store dedups by id (an
// upsert), which survives NON-contiguous re-arrivals of the same block (the old
// last-block-only heuristic could not). The heuristic stays as a fallback for
// id-less blocks (old-server compat + the optimistic user echo).
describe("chat store — by-id upsert (PRD-0010 A1)", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("same id arriving twice renders one block — even non-contiguously (tool_result in between)", () => {
    const s = useChatStore.getState();
    s.push({ id: "s_1:1", type: "text", text: "hello" });
    s.push({ id: "s_1:2", type: "tool_result", text: "tool out" });
    // Re-broadcast of the FIRST block after another block already arrived — the
    // contiguous heuristic would miss this; by-id catches it.
    s.push({ id: "s_1:1", type: "text", text: "hello" });
    const blocks = useChatStore.getState().blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.id)).toEqual(["s_1:1", "s_1:2"]);
  });

  it("setBlocks full-replace interleaved with live push converges consistently", () => {
    // A live block arrives before the authoritative history seed.
    useChatStore.getState().push({ id: "s_1:2", type: "text", text: "live-c" });
    // History seed (full replace) — includes the already-shown live block.
    useChatStore.getState().setBlocks([
      { id: "s_1:0", ts: 1, type: "user", text: "a" },
      { id: "s_1:1", ts: 2, type: "text", text: "b" },
      { id: "s_1:2", ts: 3, type: "text", text: "live-c" },
    ]);
    // A later live block, plus an idempotent re-broadcast of an existing id.
    useChatStore.getState().push({ id: "s_1:3", type: "text", text: "d" });
    useChatStore.getState().push({ id: "s_1:2", type: "text", text: "live-c" });
    expect(useChatStore.getState().blocks.map((b) => b.id)).toEqual([
      "s_1:0",
      "s_1:1",
      "s_1:2",
      "s_1:3",
    ]);
  });

  it("setBlocks collapses duplicate ids inside the incoming seed (already-doubled legacy log)", () => {
    useChatStore.getState().setBlocks([
      { id: "s_1:0", ts: 1, type: "user", text: "a" },
      { id: "s_1:0", ts: 1, type: "user", text: "a" }, // duplicate id
      { id: "s_1:1", ts: 2, type: "text", text: "b" },
    ]);
    expect(useChatStore.getState().blocks.map((b) => b.id)).toEqual(["s_1:0", "s_1:1"]);
  });

  it("id-less blocks still use the last-block heuristic (fallback, no regression)", () => {
    const s = useChatStore.getState();
    s.push({ type: "text", text: "same" });
    s.push({ type: "text", text: "same" }); // contiguous dup → collapsed
    expect(useChatStore.getState().blocks).toHaveLength(1);
    // A legit NON-contiguous repeat (e.g. the same tool run twice) is preserved.
    useChatStore.getState().push({ type: "tool_use", text: "cmd", toolName: "Bash" });
    useChatStore.getState().push({ type: "text", text: "same" });
    expect(useChatStore.getState().blocks.map((b) => b.text)).toEqual(["same", "cmd", "same"]);
  });
});
