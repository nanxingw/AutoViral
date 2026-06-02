#!/usr/bin/env node
// Build-time Remotion bundler. `desktop:build` runs this so the packaged app
// ships a PRE-BUILT bundle and never has to run webpack at runtime (no source
// shipped, no process.cwd fragility).
//
// Usage:
//   node scripts/bundle-remotion.mjs [outDir]
//   (default outDir: desktop/build-resources/remotion-bundle)
//
// The packaged app then sets AUTOVIRAL_REMOTION_BUNDLE=<that dir> so
// resolveRemotionServeUrl() returns it directly. Mirror of the runtime bundle()
// in src/server/remotion-paths.ts — keep the entryPoint + webpackOverride in
// sync with that file.

import { bundle } from "@remotion/bundler";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve everything relative to THIS script (scripts/) → repo root is one
// level up. Never use process.cwd() — that's exactly the fragility we're fixing.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

const DEFAULT_OUT = join(REPO_ROOT, "desktop/build-resources/remotion-bundle");

async function main() {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;

  const sharedAliasTarget = join(REPO_ROOT, "src/shared");

  const bundleLocation = await bundle({
    entryPoint: join(
      REPO_ROOT,
      "web/src/features/studio/composition/RemotionRoot.tsx",
    ),
    // Write into a stable, ship-able directory instead of Remotion's default
    // temp dir so the packaging step can copy it into the app.
    outDir,
    webpackOverride: (c) => {
      c.resolve = c.resolve ?? {};
      c.resolve.alias = {
        ...(c.resolve.alias ?? {}),
        "@shared": sharedAliasTarget,
      };
      // src/shared/*.ts uses NodeNext-style explicit ".js" suffixes
      // (e.g. `from "./composition.js"`). Webpack maps those to the .ts/.tsx
      // source the bundler is actually loading.
      c.resolve.extensionAlias = {
        ...(c.resolve.extensionAlias ?? {}),
        ".js": [".ts", ".tsx", ".js"],
      };
      return c;
    },
  });

  // bundle() returns the directory it wrote to (should equal outDir).
  console.log(bundleLocation);
}

main().catch((err) => {
  console.error("[bundle-remotion] failed:", err);
  process.exit(1);
});
