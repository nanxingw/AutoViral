import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionSidecar,
  findIdleSessions,
  SESSION_IDLE_TTL_MS,
  type SessionRecord,
} from "../sessions-sidecar.js";

describe("SessionSidecar — append-only manifest (ADR-008 §2)", () => {
  let dataDir: string;
  const WORK = "w_sidecar";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "av-sidecar-"));
    await mkdir(join(dataDir, "works", WORK), { recursive: true });
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const sidecar = () => new SessionSidecar(WORK, dataDir);

  it("returns [] for a work with no sidecar", async () => {
    expect(await sidecar().list()).toEqual([]);
  });

  it("create mints s_1 then s_2 per surface; chat & terminal namespaces independent", async () => {
    const sc = sidecar();
    const now = new Date().toISOString();
    const c1 = await sc.create("chat", { now });
    const c2 = await sc.create("chat", { now });
    const t1 = await sc.create("terminal", { now });
    expect(c1.id).toBe("s_1");
    expect(c2.id).toBe("s_2");
    expect(t1.id).toBe("s_1"); // terminal counter is independent of chat
    const list = await sc.list();
    expect(list.map((r) => `${r.surface}:${r.id}`)).toEqual(["chat:s_1", "chat:s_2", "terminal:s_1"]);
  });

  it("append + replay is last-write-wins by id, order stable by first-seen", async () => {
    const sc = sidecar();
    const now = new Date().toISOString();
    await sc.create("chat", { now, preview: "hello" });
    // A later append for the same id (a patch) wins on replay.
    await sc.patch("s_1", { preview: "renamed", lastActive: "2026-06-04T10:00:00Z" });
    const list = await sc.list();
    expect(list).toHaveLength(1);
    expect(list[0].preview).toBe("renamed");
    expect(list[0].lastActive).toBe("2026-06-04T10:00:00Z");

    // It is genuinely append-only — the raw file has BOTH records on disk.
    const raw = await readFile(join(dataDir, "works", WORK, ".sessions.jsonl"), "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("archive flags archived; restore clears it; both survive replay", async () => {
    const sc = sidecar();
    await sc.create("chat", { now: new Date().toISOString() });
    await sc.archive("s_1");
    expect((await sc.get("s_1"))?.archived).toBe(true);
    await sc.restore("s_1", new Date().toISOString());
    expect((await sc.get("s_1"))?.archived).toBe(false);
  });

  it("delete tombstones the record (drops from list) but never re-mints the id", async () => {
    const sc = sidecar();
    const now = new Date().toISOString();
    await sc.create("chat", { now }); // s_1
    await sc.create("chat", { now }); // s_2
    expect(await sc.delete("s_2")).toBe(true);
    const list = await sc.list();
    expect(list.map((r) => r.id)).toEqual(["s_1"]);
    // A fresh create must skip the deleted id — next is s_3, not s_2.
    const next = await sc.create("chat", { now });
    expect(next.id).toBe("s_3");
  });

  it("findIdleSessions selects only non-archived sessions past the TTL", () => {
    const now = Date.parse("2026-06-04T12:00:00Z");
    const recs: SessionRecord[] = [
      { id: "s_1", surface: "chat", createdAt: "x", lastActive: "2026-06-04T11:59:00Z", preview: "", archived: false }, // fresh
      { id: "s_2", surface: "chat", createdAt: "x", lastActive: "2026-05-01T00:00:00Z", preview: "", archived: false }, // idle
      { id: "s_3", surface: "chat", createdAt: "x", lastActive: "2026-05-01T00:00:00Z", preview: "", archived: true },  // idle but already archived
    ];
    const idle = findIdleSessions(recs, now, SESSION_IDLE_TTL_MS);
    expect(idle.map((r) => r.id)).toEqual(["s_2"]);
  });

  it("findIdleSessions honours a tiny injected TTL (tests don't wait 7 days)", () => {
    const recs: SessionRecord[] = [
      { id: "s_1", surface: "chat", createdAt: "x", lastActive: "2026-06-04T12:00:00.000Z", preview: "", archived: false },
    ];
    const now = Date.parse("2026-06-04T12:00:00.050Z"); // 50ms later
    expect(findIdleSessions(recs, now, 10).map((r) => r.id)).toEqual(["s_1"]); // 50ms > 10ms TTL
    expect(findIdleSessions(recs, now, 1000)).toEqual([]); // 50ms < 1000ms TTL
  });
});
