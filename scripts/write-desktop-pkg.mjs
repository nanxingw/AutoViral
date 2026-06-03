#!/usr/bin/env node
// Writes desktop/out/package.json so the Electron MAIN process loads as CommonJS.
//
// WHY: the root package.json has "type":"module" (the src→dist daemon is ESM),
// and electron-builder ships that root package.json into app.asar. The Electron
// main process (desktop/main.ts) is compiled to CommonJS (desktop/tsconfig.json
// module:"commonjs"). When Electron loads app.asar/desktop/out/main.js it walks
// up for the NEAREST package.json to decide module type; without one in
// desktop/out/ it finds the asar root's "type":"module" and parses the CJS main
// process as ESM → `ReferenceError: exports is not defined in ES module scope`,
// crashing the app on launch (the dialog users saw on first open).
//
// A minimal {"type":"commonjs"} marker in desktop/out/ pins main.js + preload.js
// back to CJS. Mirror of scripts/write-dist-pkg.mjs (which marks dist/ as ESM).
//
// Runs AFTER tsc (see desktop:compile = "tsc -p desktop/tsconfig.json && node
// scripts/write-desktop-pkg.mjs").

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const OUT_DIR = join(REPO_ROOT, "desktop", "out");
const OUT = join(OUT_DIR, "package.json");

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, JSON.stringify({ type: "commonjs" }, null, 2) + "\n", "utf-8");
console.log(`[write-desktop-pkg] wrote ${OUT}`);
