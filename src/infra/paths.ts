import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the package root.
 *
 * This file compiles to `dist/paths.js`, so the package root is exactly one
 * level up from the compiled module's directory (`dist/` → `..`). Resolving
 * from `import.meta.url` instead of `process.cwd()` is what makes the daemon
 * work inside a packaged Electron app, where the working directory is NOT the
 * repo checkout. All daemon code that needs to reach repo-bundled resources
 * (skills/, cli/autoviral/bin, web/dist, …) must anchor on this constant.
 */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Absolute path to the repo-contained `autoviral` CLI shim directory, injected
 * onto the spawned agent's PATH (chat-agent in ws-bridge.ts spawnCli + Studio
 * terminal in terminal-ws.ts) so the skill-documented `autoviral` command
 * resolves without a global `npm link`.
 *
 * INVARIANT — `cli/autoviral` is a SIBLING of dist/, never a child. Every ship
 * layout places it beside the compiled daemon:
 *   - npm: the `files` array lists `dist/` and `cli/autoviral/bin/` side by side
 *     → installed at node_modules/autoviral/{dist,cli/autoviral/bin}.
 *   - electron-builder: bundles `cli/autoviral/**` next to `dist/**`.
 *   - dev/test: PACKAGE_ROOT === src/, and cli/ lives at the repo root.
 * So it resolves from PACKAGE_ROOT/../cli/autoviral/bin — mirroring the bundled
 * skills/ sibling resolution in server/index.ts (join(PACKAGE_ROOT, "..",
 * "skills")). Resolving it as a CHILD (join(PACKAGE_ROOT, "cli", ...)) yields
 * the ghost path dist/cli/autoviral/bin that never exists — that was the B5
 * regression (commit 2a79daf), which silently broke `autoviral` on the agent's
 * PATH (command not found). Single source of truth — both spawn sites import
 * this so they can never drift apart again.
 */
export const CLI_BIN_DIR = join(
  PACKAGE_ROOT,
  "..",
  "cli",
  "autoviral",
  "bin",
);

/**
 * Build the PATH string injected onto a spawned agent's env so the
 * skill-documented `autoviral` command resolves. CLI_BIN_DIR is *prepended* to
 * the inherited PATH. Both spawn faces (chat-agent in ws-bridge.ts spawnCli +
 * Studio terminal in terminal-ws.ts) MUST go through this single helper so the
 * `<binDir>:<rest>` shape can never drift between them, and so the
 * PATH-injection behaviour the B5 AC names ("agent gets `autoviral` on PATH")
 * is unit-testable instead of buried inside WebSocket/pty plumbing.
 */
export function buildSpawnPath(inheritedPath: string | undefined = process.env.PATH): string {
  return `${CLI_BIN_DIR}:${inheritedPath ?? ""}`;
}

/**
 * Fail-fast guard for the `autoviral` shim dir. A missing CLI_BIN_DIR means
 * every `autoviral` command the skill documents silently dies with
 * `command not found` on the spawned agent's PATH — exactly the B5 ghost-path
 * regression. Both spawn faces call this so the failure is LOUD in the daemon
 * log at attach time instead of silent at runtime. `who` distinguishes the call
 * site in the log line. Returns whether the dir exists so callers can branch if
 * they want; the warn is the point.
 */
export function assertCliBinDir(who: string): boolean {
  if (existsSync(CLI_BIN_DIR)) return true;
  console.warn(
    `[${who}] autoviral CLI shim dir not found at ${CLI_BIN_DIR} — the spawned agent's \`autoviral\` commands will fail (command not found). Expected cli/autoviral/bin beside dist/ (run \`npm run build:cli\`?).`,
  );
  return false;
}
