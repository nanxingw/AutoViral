// electron-builder `beforeBuild` hook — rebuild native node addons against the
// TARGET Electron ABI + arch, then return false to skip electron-builder's own
// default rebuild (we've done it explicitly and per-arch).
//
// WHY explicit @electron/rebuild instead of relying on npmRebuild:true:
//   - We ship better-sqlite3 + node-pty (native). They must be built for
//     Electron's V8 ABI, NOT the system Node ABI.
//   - The daemon runs under ELECTRON_RUN_AS_NODE=1 — still the Electron binary,
//     so Electron's ABI is the correct target for the daemon's native deps too.
//   - When producing BOTH arm64 and x64 artifacts from one mac, each arch needs
//     its own rebuild; @electron/rebuild's `arch` arg does that. The default
//     npmRebuild only builds for the host arch.
//
// ⚠️ SIDE-EFFECT: electron-builder's beforeBuild ctx.appDir is the PROJECT root,
// so this rebuilds the repo's OWN node_modules/{better-sqlite3,node-pty} against
// Electron's ABI IN PLACE. After a desktop build, `npm run test:server` (system
// Node) will fail with NODE_MODULE_VERSION until you run `npm rebuild
// better-sqlite3 node-pty`. In CI this is harmless (packaging + tests run on
// separate runners/checkouts); locally, run tests BEFORE building or rebuild after.
//
// Referenced from desktop/electron-builder.yml via `beforeBuild`.

const { rebuild } = require("@electron/rebuild");

/** @param {{ appDir: string, electronVersion: string, arch: string }} ctx */
module.exports = async function beforeBuild(ctx) {
  const { appDir, electronVersion, arch } = ctx;
  console.log(
    `[before-build] rebuilding native deps for electron ${electronVersion} (${arch})`,
  );
  await rebuild({
    buildPath: appDir,
    electronVersion,
    arch,
    // Only the native modules we actually ship; avoids churning the whole tree.
    onlyModules: ["better-sqlite3", "node-pty"],
    force: true,
  });
  // Return undefined (NOT false). electron-builder's own rebuild is already
  // disabled via npmRebuild:false in electron-builder.yml. Returning false here
  // would additionally short-circuit installOrRebuild's dependency resolution,
  // which — combined with a custom files whitelist on this npm-workspace root —
  // makes the node_modules collector ship ZERO production deps. See the
  // electron-builder.yml note on the (npmRebuild:true + beforeBuild) => 0 trap.
  return undefined;
};
