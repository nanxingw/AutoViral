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
