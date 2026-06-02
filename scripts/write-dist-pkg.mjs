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
// Runs AFTER tsc (see build:backend = "tsc && node scripts/write-dist-pkg.mjs").

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const DIST_DIR = join(REPO_ROOT, "dist");
const OUT = join(DIST_DIR, "package.json");

await mkdir(DIST_DIR, { recursive: true });
await writeFile(OUT, JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
console.log(`[write-dist-pkg] wrote ${OUT}`);
