/**
 * Desktop version bridge — shared by the main process (which produces the arg)
 * and the preload (which consumes it).
 *
 * WHY this exists (bug B8): the preload used to read
 * `process.env.npm_package_version`, which npm only sets when the app is launched
 * via an npm script (dev). A packaged Electron binary has no such env var, so the
 * exposed desktop version ALWAYS fell back to a hardcoded "0.1.0".
 *
 * Fix: the main process owns the truth via `app.getVersion()` (electron-builder
 * stamps the real version into the asar's package.json, which `app.getVersion()`
 * reads in BOTH dev and packaged builds). It hands that version to the renderer
 * through `webPreferences.additionalArguments`, which Electron appends to the
 * preload's `process.argv`. The preload — running sandboxed, with no Node
 * `require` and no env inheritance — parses it back out of argv.
 *
 * Kept as a pure, dependency-free module so it is unit-testable without booting
 * Electron.
 */

/** Sentinel prefix on the additionalArguments entry carrying the app version. */
export const VERSION_ARG_PREFIX = "--autoviral-version=";

/**
 * main.ts: build the additionalArguments entry from `app.getVersion()`.
 * @example webPreferences.additionalArguments = [buildVersionArg(app.getVersion())]
 */
export function buildVersionArg(appVersion: string): string {
  return `${VERSION_ARG_PREFIX}${appVersion}`;
}

/**
 * preload.ts: recover the injected version from `process.argv`. Returns
 * `fallback` only when the sentinel arg is absent or carries an empty value —
 * never a hardcoded "0.1.0".
 */
export function parseDesktopVersion(argv: readonly string[], fallback: string): string {
  for (const arg of argv) {
    if (arg.startsWith(VERSION_ARG_PREFIX)) {
      const value = arg.slice(VERSION_ARG_PREFIX.length).trim();
      if (value) return value;
    }
  }
  return fallback;
}
