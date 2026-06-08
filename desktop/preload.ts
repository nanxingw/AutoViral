/**
 * Preload — runs in an isolated context with Node integration disabled. We
 * expose only a tiny, read-only surface to the renderer via contextBridge.
 * Nothing here grants the web app filesystem / process access; it's purely
 * informational (version + platform) so the Studio UI can show "Desktop vX".
 */
import { contextBridge } from "electron";
import { parseDesktopVersion } from "./version.js";

contextBridge.exposeInMainWorld("autoviralDesktop", {
  /** Present + truthy only inside the Electron shell. */
  isDesktop: true,
  /**
   * Real app version, injected by the main process via
   * `webPreferences.additionalArguments` (see desktop/main.ts + desktop/version.ts).
   * The previous `process.env.npm_package_version` was unset in packaged builds,
   * so the version ALWAYS fell back to a hardcoded "0.1.0" (bug B8). The fallback
   * here is a clearly-bogus sentinel, never a plausible-looking version, so any
   * regression is obvious rather than silently shipping a wrong-but-believable
   * number.
   */
  version: parseDesktopVersion(process.argv, "0.0.0-unknown"),
  /** "darwin" | "win32" | "linux". */
  platform: process.platform,
});
