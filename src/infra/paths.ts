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
