import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "../server/__tests__/_helpers.js";

describe("work-store — D3 type cleanup", () => {
  beforeEach(() => vi.resetModules());

  it("createWork no longer attaches pipeline / evaluationMode / eval* fields", async () => {
    await withTempDataDir(async () => {
      const { createWork, getWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      expect(w).not.toHaveProperty("pipeline");
      expect(w).not.toHaveProperty("evaluationMode");
      expect(w).not.toHaveProperty("evalSessionIds");
      expect(w).not.toHaveProperty("evalAttempts");

      const reloaded = await getWork(w.id);
      expect(reloaded).not.toHaveProperty("pipeline");
    });
  });

  it("updateWork strips legacy pipeline if passed in", async () => {
    await withTempDataDir(async () => {
      const { createWork, updateWork } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      // Simulate old caller still sending pipeline — should be ignored, not stored
      const out = await updateWork(w.id, { pipeline: { research: { name: "x", status: "done" } } } as any);
      expect(out).not.toHaveProperty("pipeline");
    });
  });

  // #83 — a blank work stores an EMPTY title (not a localized placeholder);
  // the UI localizes "未命名/Untitled" at render. The store must accept and
  // round-trip an empty title without coercing it to anything.
  it("createWork accepts an empty title and round-trips it (#83)", async () => {
    await withTempDataDir(async () => {
      const { createWork, getWork } = await import("./work-store.js");
      const w = await createWork({ title: "", type: "short-video", platforms: ["douyin"] });
      expect(w.title).toBe("");
      const reloaded = await getWork(w.id);
      expect(reloaded?.title).toBe("");
    });
  });
});

// PRD-0010 A1 (seed 收敛) — the default-session HTTP seed reads chat.jsonl FIRST
// (the live per-block append log), falling back to the chat.json snapshot only
// when no jsonl exists. Reading the stale snapshot first caused the mid-turn
// "flashback" (HTTP seed showed the last turn, WS reseed then jumped forward).
// Covers the three on-disk work forks: jsonl-only, snapshot-only, both.
describe("work-store — loadWorkChat jsonl-first + id fallback (PRD-0010 A1)", () => {
  beforeEach(() => vi.resetModules());

  type Block = Record<string, unknown>;
  const jsonl = (blocks: Block[]) => blocks.map((b) => JSON.stringify(b)).join("\n") + "\n";

  it("default session reads jsonl-first — a fresh jsonl wins over a stale chat.json snapshot (both present)", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const wd = join(dir, "works", w.id);
      // Stale snapshot (last turn only).
      await writeFile(
        join(wd, "chat.json"),
        JSON.stringify({ blocks: [{ type: "text", text: "STALE" }] }),
        "utf-8",
      );
      // Fresh append log (current turn included).
      await writeFile(
        join(wd, "chat.jsonl"),
        jsonl([
          { type: "user", text: "fresh-a" },
          { type: "text", text: "fresh-b" },
        ]),
        "utf-8",
      );
      const chat = await loadWorkChat(w.id);
      expect((chat?.blocks as Block[]).map((b) => b.text)).toEqual(["fresh-a", "fresh-b"]);
    });
  });

  it("falls back to the chat.json snapshot only when no jsonl exists (legacy snapshot-only fork)", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const wd = join(dir, "works", w.id);
      await writeFile(
        join(wd, "chat.json"),
        JSON.stringify({ blocks: [{ type: "user", text: "snap-a" }, { type: "text", text: "snap-b" }] }),
        "utf-8",
      );
      const chat = await loadWorkChat(w.id);
      expect((chat?.blocks as Block[]).map((b) => b.text)).toEqual(["snap-a", "snap-b"]);
    });
  });

  it("jsonl-only work returns its jsonl blocks", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      await writeFile(
        join(dir, "works", w.id, "chat.jsonl"),
        jsonl([{ type: "user", text: "only-a" }]),
        "utf-8",
      );
      const chat = await loadWorkChat(w.id);
      expect((chat?.blocks as Block[]).map((b) => b.text)).toEqual(["only-a"]);
    });
  });

  it("id-less legacy lines synthesize hist_{i} ids; id-bearing lines pass through", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      // Legacy (no id) jsonl → hist_0 / hist_1.
      await writeFile(
        join(dir, "works", w.id, "chat.jsonl"),
        jsonl([{ type: "user", text: "a" }, { type: "text", text: "b" }]),
        "utf-8",
      );
      const legacy = await loadWorkChat(w.id);
      expect((legacy?.blocks as Block[]).map((b) => b.id)).toEqual(["hist_0", "hist_1"]);

      // New (id-bearing) jsonl → passthrough.
      await writeFile(
        join(dir, "works", w.id, "chat.jsonl"),
        jsonl([
          { id: "s_1:0", type: "user", text: "a" },
          { id: "s_1:1", type: "text", text: "b" },
        ]),
        "utf-8",
      );
      const withIds = await loadWorkChat(w.id);
      expect((withIds?.blocks as Block[]).map((b) => b.id)).toEqual(["s_1:0", "s_1:1"]);
    });
  });

  it("collapses a pre-A1 double-write: adjacent id-less twins fold to one id (w_20260408_1347_db8 — HTTP seed lockstep with WS)", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      // Real legacy shape: one user line recorded twice (identical type+text,
      // differing only by timestamp). Without a collapse the twins get hist_0 /
      // hist_1 → the client's by-id dedup can't fold them → double bubble.
      await writeFile(
        join(dir, "works", w.id, "chat.jsonl"),
        jsonl([
          { type: "user", text: "同一句", timestamp: "2026-04-08T06:46:16.335Z" },
          { type: "user", text: "同一句", timestamp: "2026-04-08T06:46:29.940Z" },
          { type: "text", text: "reply" },
        ]),
        "utf-8",
      );
      const chat = await loadWorkChat(w.id);
      // Twin folds; the distinct reply keeps its original index (lockstep with
      // ws-bridge assignFallbackIds → both seed paths agree on the id).
      expect((chat?.blocks as Block[]).map((b) => b.id)).toEqual(["hist_0", "hist_2"]);
      expect((chat?.blocks as Block[]).map((b) => b.text)).toEqual(["同一句", "reply"]);
    });
  });

  it("does NOT collapse adjacent id-less rows that differ on type/text/toolName", async () => {
    await withTempDataDir(async (dir) => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      await writeFile(
        join(dir, "works", w.id, "chat.jsonl"),
        jsonl([
          { type: "user", text: "a" },
          { type: "user", text: "b" },
          { type: "tool_use", text: "x", toolName: "Bash" },
          { type: "tool_use", text: "x", toolName: "Read" },
        ]),
        "utf-8",
      );
      const chat = await loadWorkChat(w.id);
      expect((chat?.blocks as Block[]).map((b) => b.id)).toEqual([
        "hist_0",
        "hist_1",
        "hist_2",
        "hist_3",
      ]);
    });
  });

  it("returns null when the session has neither a jsonl nor a snapshot", async () => {
    await withTempDataDir(async () => {
      const { createWork, loadWorkChat } = await import("./work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      expect(await loadWorkChat(w.id)).toBeNull();
    });
  });
});
