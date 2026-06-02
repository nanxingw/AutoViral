/**
 * Preload — runs in an isolated context with Node integration disabled. We
 * expose only a tiny, read-only surface to the renderer via contextBridge.
 * Nothing here grants the web app filesystem / process access; it's purely
 * informational (version + platform) so the Studio UI can show "Desktop vX".
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("autoviralDesktop", {
  /** Present + truthy only inside the Electron shell. */
  isDesktop: true,
  /** App version (injected from package.json via the build). */
  version: process.env.npm_package_version ?? "0.1.0",
  /** "darwin" | "win32" | "linux". */
  platform: process.platform,
});
