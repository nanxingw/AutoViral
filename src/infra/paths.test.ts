import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  PACKAGE_ROOT,
  CLI_BIN_DIR,
  buildSpawnPath,
  assertCliBinDir,
} from "./paths.js";
import { manualDir } from "../server/bridge/routes.js";

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
// join(PACKAGE_ROOT, "..", "skills", "autoviral", "manual"). We call the REAL
// exported function (with AUTOVIRAL_MANUAL_DIR unset) so a child→child
// regression in routes.ts actually turns this red — a parallel-constructed
// string would not. (The /docs route suite in routes.test.ts always sets
// AUTOVIRAL_MANUAL_DIR in beforeEach, so it never reaches this fallback branch.)
describe("manualDir() sibling resolution (the real exported function)", () => {
  const prev = process.env.AUTOVIRAL_MANUAL_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.AUTOVIRAL_MANUAL_DIR;
    else process.env.AUTOVIRAL_MANUAL_DIR = prev;
  });

  it("resolves the manual as a SIBLING of PACKAGE_ROOT (no ghost dist/ child)", () => {
    delete process.env.AUTOVIRAL_MANUAL_DIR; // exercise the fallback branch
    const dir = manualDir();
    // Pins the exact sibling resolution: the old child write
    // (join(PACKAGE_ROOT, "skills", "autoviral", "manual")) fails this.
    expect(dir).toBe(join(PACKAGE_ROOT, "..", "skills", "autoviral", "manual"));
    // And it really exists with a real page (so `autoviral docs` serves content).
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "_shared", "00-quickstart.md"))).toBe(true);
  });

  it("honours AUTOVIRAL_MANUAL_DIR override when set", () => {
    process.env.AUTOVIRAL_MANUAL_DIR = "/tmp/some-override-manual";
    expect(manualDir()).toBe("/tmp/some-override-manual");
  });
});

// B5 second-slice MEDIUM: the AC-named behaviour "agent gets `autoviral` on its
// PATH" was untested — paths.test.ts only pinned the constant + fs existence,
// and the two spawn faces wired the PATH string inline. buildSpawnPath is the
// single helper both faces now call, so pinning it here钉死 the injection shape:
// CLI_BIN_DIR is PREPENDED. A future "误删 PATH 前缀 / 写成空" regression turns
// this red instead of silently shipping `command not found`.
describe("buildSpawnPath (the injected agent PATH)", () => {
  it("prepends CLI_BIN_DIR to the inherited PATH", () => {
    expect(buildSpawnPath("/usr/bin:/bin")).toBe(`${CLI_BIN_DIR}:/usr/bin:/bin`);
  });

  it("starts with CLI_BIN_DIR + ':' so the shim shadows a global autoviral", () => {
    expect(buildSpawnPath("/usr/bin").startsWith(`${CLI_BIN_DIR}:`)).toBe(true);
  });

  it("handles an empty inherited PATH (trailing empty segment, never the string 'undefined')", () => {
    // The `?? ""` guard means a missing PATH yields a bare trailing colon, never
    // the literal "undefined" — which would silently break command resolution.
    expect(buildSpawnPath("")).toBe(`${CLI_BIN_DIR}:`);
    // And an explicit null-ish value coalesces to "" rather than stringifying.
    expect(buildSpawnPath(undefined as unknown as string)).not.toContain("undefined");
  });
});

describe("assertCliBinDir (fail-fast guard shared by both spawn faces)", () => {
  it("returns true when the shim dir exists (no warn)", () => {
    // In dev/test PACKAGE_ROOT === src/, so the real committed shim exists.
    expect(assertCliBinDir("test")).toBe(true);
  });
});
