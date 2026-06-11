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
 * Repo-root `web/` source tree (Vite/React app), resolved as a SIBLING of dist/.
 *
 * INVARIANT — same child-vs-sibling rule as CLI_BIN_DIR / skills/. `web/` lives
 * at the repo root, BESIDE the compiled daemon, never inside it:
 *   - dev/test: PACKAGE_ROOT === src/, and web/ is its sibling at the repo root.
 *   - npm/electron: the daemon ships from dist/, and the Remotion entry's source
 *     only exists in dev — packaged builds set AUTOVIRAL_REMOTION_BUNDLE to a
 *     PRE-BUILT bundle dir and never touch this path (see remotion-paths.ts).
 * Resolving it as a CHILD (join(PACKAGE_ROOT, "web", ...)) yields the ghost path
 * dist/web/... that never exists — that was the D1 regression: the runtime
 * webpack bundle() crashed with a bare ENOENT, breaking render/export/snapshot
 * 100% under a bare dist daemon (no AUTOVIRAL_REMOTION_BUNDLE). Mirrors the B5
 * cli/ + skills/ sibling fixes — single source of truth for both render faces
 * (remotion-renderer.ts + render/remotion-bridge.ts via remotion-paths.ts).
 */
export const WEB_SRC_ROOT = join(PACKAGE_ROOT, "..", "web", "src");

/**
 * Repo-root `src/shared/` TypeScript tree — the `@shared/*` alias target webpack
 * resolves inside the bundled Remotion composition. Same SIBLING-of-dist/ rule
 * as WEB_SRC_ROOT: the shared source lives at the repo root beside dist/, so the
 * old child write (join(PACKAGE_ROOT, "src/shared") → dist/src/shared) was a
 * ghost path that silently broke the bundle's `@shared` imports.
 */
export const SHARED_SRC_ROOT = join(PACKAGE_ROOT, "..", "src", "shared");

/**
 * Absolute path to the Remotion composition entry the runtime webpack bundler
 * loads (web/src/features/studio/composition/RemotionRoot.tsx), resolved off
 * WEB_SRC_ROOT so it follows the sibling-of-dist/ invariant. Centralised here so
 * the path string can't drift and so doctor + remotion-paths share one truth.
 */
export const REMOTION_ENTRY_POINT = join(
  WEB_SRC_ROOT,
  "features",
  "studio",
  "composition",
  "RemotionRoot.tsx",
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
