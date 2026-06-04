#!/usr/bin/env node
// Writes dist/package.json so the compiled daemon loads as ESM.
//
// WHY: the root package.json has "type":"module", but `files`/build steps copy
// dist/** without the root package.json. When the packaged daemon runs from
// app.asar.unpacked/dist/index.js, Node walks up looking for the NEAREST
// package.json to decide module type. Without dist/package.json it finds the
// app's CJS-shaped manifest (or none) and parses the ESM daemon as CJS →
// SyntaxError. A minimal {"type":"module"} marker in dist/ fixes it.
//
// We also stamp the root package's `version` here. In a packaged build,
// PACKAGE_ROOT resolves to dist/, so the daemon (e.g. `autoviral whoami` via
// src/server/bridge/routes.ts) reads its version from dist/package.json. Keep
// it in sync with the root manifest so the reported version never drifts.
//
// Runs AFTER tsc (see build:backend = "tsc && node scripts/write-dist-pkg.mjs").

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const DIST_DIR = join(REPO_ROOT, "dist");
const OUT = join(DIST_DIR, "package.json");

const rootPkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf-8"));

await mkdir(DIST_DIR, { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ type: "module", version: rootPkg.version }, null, 2) + "\n",
  "utf-8",
);
console.log(`[write-dist-pkg] wrote ${OUT} (version ${rootPkg.version})`);
