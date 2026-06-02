// npm `postinstall` guard.
//
// dist/ is gitignored and only exists AFTER `npm run build` (or inside the
// published npm tarball, where `files` ships dist/). On a fresh git checkout
// — CI `npm ci`, or a developer `git clone && npm install` — dist/postinstall.js
// does NOT exist yet, and `node dist/postinstall.js` would fail with
// MODULE_NOT_FOUND, aborting the whole install (exit 1) before the build can run.
//
// This guard makes the install lifecycle tolerant of the not-yet-built state:
// run the real postinstall only when dist/postinstall.js is present; otherwise
// no-op silently. The real script (src/postinstall.ts → dist/postinstall.js) is
// itself wrapped in try/catch and only warns, so the sole hard failure was Node
// failing to FIND the file — which this guard removes.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "dist", "postinstall.js");

if (existsSync(target)) {
  import(pathToFileURL(target).href).catch((e) => {
    console.warn("autoviral: postinstall skipped:", e?.message ?? e);
  });
}
// else: fresh checkout before build — nothing to do; let install succeed.
