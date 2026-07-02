import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSidecar } from "../sessions-sidecar.js";
import { resolveBackendId } from "../../chat-backends/registry.js";

// C4 (PRD-0010) — the per-session `backend` field on SessionRecord.
// Locks: (1) a chosen backend persists round-trip through create → list/get;
// (2) a legacy record written WITHOUT the field reads back with backend
// undefined and resolves to the "claude" default (no silent codex spawn).
describe("SessionSidecar — per-session backend field (C4)", () => {
  let dataDir: string;
  const WORK = "w_backend";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "av-sidecar-backend-"));
    await mkdir(join(dataDir, "works", WORK), { recursive: true });
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const sidecar = () => new SessionSidecar(WORK, dataDir);

  it("persists a chosen backend round-trip (create → get)", async () => {
    const sc = sidecar();
    const now = new Date().toISOString();
    const rec = await sc.create("chat", { now, backend: "codex" });
    expect(rec.backend).toBe("codex");
    const got = await sc.get(rec.id);
    expect(got?.backend).toBe("codex");
  });

  it("defaults to claude for a legacy record written without the field", async () => {
    // Hand-write a pre-C4 record (no `backend` key) so we read exactly what an
    // old sidecar file holds — the migration must not fail on it.
    const file = join(dataDir, "works", WORK, ".sessions.jsonl");
    const legacy = {
      id: "s_1",
      surface: "chat",
      cliSessionId: "cli-legacy",
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      preview: "旧会话",
      archived: false,
    };
    await appendFile(file, JSON.stringify(legacy) + "\n", "utf-8");

    const got = await sidecar().get("s_1");
    expect(got).toBeDefined();
    expect(got?.backend).toBeUndefined();
    // The registry resolves the absent field to the claude default.
    expect(resolveBackendId(got?.backend)).toBe("claude");
  });

  it("a backend patch survives replay (last-write-wins)", async () => {
    const sc = sidecar();
    const now = new Date().toISOString();
    await sc.create("chat", { now, id: "s_1" }); // no backend → legacy-ish
    await sc.patch("s_1", { backend: "codex" });
    const got = await sc.get("s_1");
    expect(got?.backend).toBe("codex");
  });
});
