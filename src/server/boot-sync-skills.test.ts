import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PACKAGE_ROOT } from "../infra/paths.js";

// The daemon boot hook must (1) invoke the shared syncSkills core with the
// PACKAGE_ROOT-anchored source + ~/.claude/skills target + a sibling marker, and
// (2) NEVER let a sync failure block boot. startServer just `await`s
// bootSyncSkills with no catch of its own, so bootSyncSkills swallowing every
// rejection is exactly what keeps the daemon coming up. We mock the skill-sync
// module so the test asserts the wiring without touching the real ~/.claude dir.

const syncSkillsMock = vi.fn();
vi.mock("../infra/skill-sync.js", () => ({
  syncSkills: (...args: unknown[]) => syncSkillsMock(...args),
}));

describe("bootSyncSkills (daemon boot hook)", () => {
  beforeEach(() => {
    syncSkillsMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("points syncSkills at a source dir that ACTUALLY holds the bundled autoviral skill (not a phantom dist/skills)", async () => {
    syncSkillsMock.mockResolvedValue({ synced: true, reason: "skill missing" });
    const { bootSyncSkills } = await import("./index.js");

    await bootSyncSkills();

    expect(syncSkillsMock).toHaveBeenCalledTimes(1);
    const arg = syncSkillsMock.mock.calls[0][0] as {
      sourceSkillsDir: string;
      targetSkillsDir: string;
      version: string;
      markerPath: string;
    };
    // BEHAVIOUR — the assertion that catches a wrong source path: the dir the
    // boot hook points at must REALLY exist and hold the bundled skill. If it
    // doesn't, syncSkills hits its `!existsSync(sourceSkillsDir)` early return
    // and silently syncs NOTHING — and boot-sync is the ONLY sync route the
    // Electron desktop update path has (it never runs npm postinstall).
    expect(existsSync(arg.sourceSkillsDir)).toBe(true);
    expect(existsSync(join(arg.sourceSkillsDir, "autoviral", "SKILL.md"))).toBe(true);
    // Resolves the SAME sibling-of-dist way postinstall does
    // (postinstall.ts: join(__dirname, "..", "skills")), so the two install
    // routes can never diverge again. PACKAGE_ROOT === dist/ (packaged) or src/
    // (dev), and skills/ is its SIBLING, so the source is PACKAGE_ROOT/../skills.
    expect(arg.sourceSkillsDir).toBe(join(PACKAGE_ROOT, "..", "skills"));
    expect(arg.targetSkillsDir).toBe(join(homedir(), ".claude", "skills"));
    // Marker lives OUTSIDE the copied subtree (sibling of autoviral/).
    expect(arg.markerPath).toBe(
      join(homedir(), ".claude", "skills", ".autoviral-synced.json"),
    );
    // Version is the real package version (never the "0.0.0" fallback in-repo).
    expect(arg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(arg.version).not.toBe("0.0.0");
  });

  it("resolves (does NOT throw) when syncSkills rejects — boot is never blocked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    syncSkillsMock.mockRejectedValue(new Error("EACCES: read-only HOME"));
    const { bootSyncSkills } = await import("./index.js");

    // The whole point: a rejecting sync must be swallowed here so startServer's
    // bare `await bootSyncSkills()` resolves and the daemon comes up anyway.
    await expect(bootSyncSkills()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
