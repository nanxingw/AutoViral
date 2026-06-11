// Remotion serve-URL + browser-executable resolution, factored out of the two
// render paths (remotion-renderer.ts canonical + render/remotion-bridge.ts
// streaming) so packaging can swap the runtime webpack bundle for a pre-built
// one.
//
// WHY: both render paths used to bundle TypeScript SOURCE at runtime via
// `process.cwd()` (entryPoint = web/src/.../RemotionRoot.tsx, @shared alias =
// src/shared). In a packaged Electron app `process.cwd()` is NOT the repo root
// and `web/src` isn't shipped, so render broke 100%. We now:
//   - resolve the entryPoint + @shared alias as SIBLINGS of dist/ (via the
//     centralised REMOTION_ENTRY_POINT / SHARED_SRC_ROOT constants in
//     infra/paths.ts — anchored on PACKAGE_ROOT, derived from this module's own
//     URL, not the cwd), the same child-vs-sibling rule as cli/ + skills/. The
//     D1 bug resolved these as CHILDREN of PACKAGE_ROOT (web/src, src/shared),
//     which under a bare dist daemon became the ghost paths dist/web/...,
//     dist/src/shared → webpack ENOENT → render/export/snapshot 100% broken, and
//   - let `desktop:build` pre-build the bundle into a dir and pass it via
//     AUTOVIRAL_REMOTION_BUNDLE so the packaged app does ZERO runtime webpack.
//
// Remotion's selectComposition / renderMedia / renderFrames also download a
// Chromium Headless Shell when `browserExecutable` is unset — which fails into a
// read-only asar in a packaged app. AUTOVIRAL_CHROMIUM_PATH lets packaging point
// at the bundled binary.

import { bundle } from "@remotion/bundler";
import { existsSync } from "node:fs";
import { REMOTION_ENTRY_POINT, SHARED_SRC_ROOT } from "../infra/paths.js";

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

  // D1 — fail LOUD + actionable before webpack does. The entry point is resolved
  // as a SIBLING of dist/ (REMOTION_ENTRY_POINT, see infra/paths.ts). Under a
  // bare dist daemon (npm / packaged-but-no-prebuilt-bundle) web/src isn't
  // shipped, so this dir doesn't exist → bundle() would crash with a raw webpack
  // ENOENT stack that tells the user nothing. Instead surface what's missing and
  // exactly how to fix it (set AUTOVIRAL_REMOTION_BUNDLE to a pre-built bundle,
  // or run from a checkout that contains web/src). All three render faces
  // (/export, /snapshot, the render queue) inherit this message because they all
  // funnel through resolveRemotionServeUrl().
  if (!existsSync(REMOTION_ENTRY_POINT)) {
    throw new Error(
      "Remotion 渲染入口缺失：找不到 " +
        REMOTION_ENTRY_POINT +
        "。render / export / snapshot 需要一个可用的 Remotion 渲染入口。" +
        "修复：① 设置环境变量 AUTOVIRAL_REMOTION_BUNDLE 指向预构建的 bundle 目录" +
        "（打包构建用 `npm run desktop:build` 产出）；或 ② 从包含 web/src 的仓库" +
        "检出运行 daemon（dev 模式）。诊断可跑 `autoviral doctor`。",
    );
  }

  // Mirror web/tsconfig.json paths so Remotion's webpack resolves `@shared/*`
  // imports inside the bundled composition tree the same way Vite does.
  return bundle({
    entryPoint: REMOTION_ENTRY_POINT,
    webpackOverride: (c) => {
      c.resolve = c.resolve ?? {};
      c.resolve.alias = {
        ...(c.resolve.alias ?? {}),
        "@shared": SHARED_SRC_ROOT,
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
