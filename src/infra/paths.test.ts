import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PACKAGE_ROOT, CLI_BIN_DIR } from "./paths.js";

// Regression guard for B5 (PRD-0009): the `autoviral` shim dir injected onto the
// spawned agent's PATH (ws-bridge.ts spawnCli + terminal-ws.ts pty-pool) must be
// resolved as a SIBLING of dist/ — `cli/autoviral` is shipped beside dist/ in
// every layout (npm `files`, electron-builder, dev/test src/), NOT inside it.
// Commit 2a79daf regressed this from process.cwd() to join(PACKAGE_ROOT, "cli",
// ...) — a CHILD path — which resolves to the ghost dir dist/cli/autoviral/bin
// that never exists, so the agent got `autoviral: command not found`.
describe("CLI_BIN_DIR", () => {
  it("is a SIBLING of PACKAGE_ROOT (../cli/autoviral/bin), not a child", () => {
    // Pin the exact sibling resolution — mirrors how boot-sync-skills.test.ts:51
    // pins skills/ as join(PACKAGE_ROOT, "..", "skills"). The old child write
    // (join(PACKAGE_ROOT, "cli", "autoviral", "bin")) fails this assertion.
    expect(CLI_BIN_DIR).toBe(
      join(PACKAGE_ROOT, "..", "cli", "autoviral", "bin"),
    );
  });

  it("ends with cli/autoviral/bin", () => {
    expect(CLI_BIN_DIR.endsWith(join("cli", "autoviral", "bin"))).toBe(true);
  });

  it("points at a dir that REALLY holds the autoviral shim (strongest guard)", () => {
    // The assertion that catches the ghost-path regression: in dev/test
    // PACKAGE_ROOT === src/, so src/../cli/autoviral/bin/autoviral is the real
    // committed shim and EXISTS. The old child write resolved to
    // src/cli/autoviral/bin (does not exist) → this turns red. If this dir is
    // wrong, every spawned agent silently gets `command not found`.
    expect(existsSync(CLI_BIN_DIR)).toBe(true);
    expect(existsSync(join(CLI_BIN_DIR, "autoviral"))).toBe(true);
  });
});

// Same child-vs-sibling family: manualDir() in src/server/bridge/routes.ts feeds
// `autoviral docs` (the manual the agent is told to read). skills/autoviral is a
// SIBLING of dist/ exactly like cli/, so the manual must resolve via
// join(PACKAGE_ROOT, "..", "skills", "autoviral", "manual"). manualDir() is
// module-private (and honours AUTOVIRAL_MANUAL_DIR first), so we pin the
// underlying sibling path directly here.
describe("bundled manual dir (manualDir sibling resolution)", () => {
  it("resolves the manual as a SIBLING of PACKAGE_ROOT and it really exists", () => {
    const manualDir = join(PACKAGE_ROOT, "..", "skills", "autoviral", "manual");
    expect(existsSync(manualDir)).toBe(true);
    // A real manual page must be present (not just the dir) so `autoviral docs`
    // has content to serve.
    expect(existsSync(join(manualDir, "_shared", "00-quickstart.md"))).toBe(
      true,
    );
  });
});
