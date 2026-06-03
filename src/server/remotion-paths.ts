// Remotion serve-URL + browser-executable resolution, factored out of the two
// render paths (remotion-renderer.ts canonical + render/remotion-bridge.ts
// streaming) so packaging can swap the runtime webpack bundle for a pre-built
// one.
//
// WHY: both render paths used to bundle TypeScript SOURCE at runtime via
// `process.cwd()` (entryPoint = web/src/.../RemotionRoot.tsx, @shared alias =
// src/shared). In a packaged Electron app `process.cwd()` is NOT the repo root
// and `web/src` isn't shipped, so render broke 100%. We now:
//   - resolve the entryPoint + @shared alias against PACKAGE_ROOT (stable,
//     derived from this module's own URL — not the cwd), and
//   - let `desktop:build` pre-build the bundle into a dir and pass it via
//     AUTOVIRAL_REMOTION_BUNDLE so the packaged app does ZERO runtime webpack.
//
// Remotion's selectComposition / renderMedia / renderFrames also download a
// Chromium Headless Shell when `browserExecutable` is unset — which fails into a
// read-only asar in a packaged app. AUTOVIRAL_CHROMIUM_PATH lets packaging point
// at the bundled binary.

import { bundle } from "@remotion/bundler";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../infra/paths.js";

/**
 * Resolve the Remotion serve URL (a bundle directory / URL passed to
 * selectComposition + renderMedia/renderFrames as `serveUrl`).
 *
 * - Packaged app: `AUTOVIRAL_REMOTION_BUNDLE` points at the pre-built bundle dir
 *   that `scripts/bundle-remotion.mjs` produced at build time → return it
 *   directly, no runtime webpack.
 * - Dev / unset: run the same `bundle()` we always have, but resolve the
 *   entryPoint and the `@shared` alias against PACKAGE_ROOT instead of the
 *   process cwd, so it works no matter where the daemon was launched from.
 */
export async function resolveRemotionServeUrl(): Promise<string> {
  const prebuilt = process.env.AUTOVIRAL_REMOTION_BUNDLE;
  if (prebuilt) return prebuilt;

  // Mirror web/tsconfig.json paths so Remotion's webpack resolves `@shared/*`
  // imports inside the bundled composition tree the same way Vite does.
  const sharedAliasTarget = join(PACKAGE_ROOT, "src/shared");
  return bundle({
    entryPoint: join(
      PACKAGE_ROOT,
      "web/src/features/studio/composition/RemotionRoot.tsx",
    ),
    webpackOverride: (c) => {
      c.resolve = c.resolve ?? {};
      c.resolve.alias = {
        ...(c.resolve.alias ?? {}),
        "@shared": sharedAliasTarget,
      };
      // src/shared/*.ts uses NodeNext-style explicit ".js" suffixes
      // (e.g. `from "./composition.js"`). Webpack must map those to the
      // .ts/.tsx source the bundler is actually loading.
      c.resolve.extensionAlias = {
        ...(c.resolve.extensionAlias ?? {}),
        ".js": [".ts", ".tsx", ".js"],
      };
      return c;
    },
  });
}

/**
 * The Chromium executable Remotion should drive, or `undefined` to let Remotion
 * auto-download a Headless Shell (the dev default). In a packaged app this is
 * set to the bundled binary so we never try to write into a read-only asar.
 */
export function remotionBrowserExecutable(): string | undefined {
  return process.env.AUTOVIRAL_CHROMIUM_PATH || undefined;
}
