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

  // NOTE: this covers the DEFENSIVE same-id dedup only. A real pre-A1 doubled
  // legacy log has NO ids on either twin, so it never reaches setBlocks doubled —
  // the twin is folded upstream when fallback ids are synthesized. That AC (e.g.
  // w_20260408_1347_db8) is covered by work-store.test.ts / ws-bridge-block-id.test.ts.
  it("setBlocks collapses duplicate ids inside the incoming seed (defensive same-id dedup)", () => {
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

  // A1 review — the coach path (POST /api/coach/message → recordUserMessage →
  // broadcastToSession `block`) re-broadcasts the recorded user block WITH its
  // stable id back to the SAME tab that already rendered an optimistic id-less
  // echo (useChatSocket.send always pushes `{type:"user",text}`). Before this fix
  // the id branch saw no block with that id and appended a SECOND identical
  // bubble — the exact "message doubling" A1 was meant to kill. The server block
  // must instead ADOPT the id onto the optimistic echo (upsert in place).
  it("adopts the optimistic user echo when the server re-broadcasts it WITH a stable id (coach path — no double bubble)", () => {
    const s = useChatStore.getState();
    // send() optimistic local echo — the tab can't know its server id yet, so
    // push() synthesizes a client-local `b_…` id.
    s.push({ type: "user", text: "hi coach" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    expect(useChatStore.getState().blocks[0].id).toMatch(/^b_/);
    // recordUserMessage re-broadcasts the recorded block WITH its stable id.
    s.push({ id: "coach_main:0", type: "user", text: "hi coach" });
    const blocks = useChatStore.getState().blocks;
    expect(blocks).toHaveLength(1); // adopted in place, NOT stacked as a 2nd bubble
    expect(blocks[0].id).toBe("coach_main:0");
    expect(blocks[0].text).toBe("hi coach");
  });

  it("only adopts the matching optimistic echo — an unrelated client-local block stays put", () => {
    const s = useChatStore.getState();
    s.push({ type: "text", text: "assistant said" }); // unrelated client-local block
    s.push({ type: "user", text: "my message" }); // the optimistic echo
    s.push({ id: "s_1:5", type: "user", text: "my message" }); // its server twin
    const blocks = useChatStore.getState().blocks;
    expect(blocks).toHaveLength(2); // no false adoption, no double bubble
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ["text", "assistant said"],
      ["user", "my message"],
    ]);
    expect(blocks[0].id).toMatch(/^b_/); // untouched client-local id
    expect(blocks[1].id).toBe("s_1:5"); // echo adopted the server id
  });
});
