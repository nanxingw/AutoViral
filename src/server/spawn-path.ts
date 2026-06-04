// macOS daemon PATH repair.
//
// A process NOT launched from a login shell — an Electron .app double-click, a
// launchd job, or an agent harness running `node dist/index.js start` —
// inherits a minimal PATH that omits Homebrew's bin dir (/opt/homebrew/bin on
// Apple Silicon, /usr/local/bin on Intel). The daemon spawns ffmpeg / ffprobe /
// edge-tts BY BARE NAME (see ffmpeg-paths.ts + audio-tools.ts), so
// child_process.spawn resolves them against that inherited PATH and fails with
// ENOENT — even though the tools are installed (e.g. /opt/homebrew/bin/ffmpeg).
//
// We repair PATH once at boot so every spawned child (which inherits
// process.env.PATH) can find those tools regardless of how the daemon was
// launched. This is orthogonal to the packaged-app FFMPEG_PATH / FFPROBE_PATH
// overrides: those point ffmpeg/ffprobe at bundled binaries in a .app, while
// this also rescues edge-tts and any other bare-name tool in the dev /
// local-daemon case where no overrides are set.

/** Canonical bin dirs a macOS daemon needs but a non-login-shell launch drops.
 *  Order here is the precedence used when appending missing dirs. */
const DARWIN_BIN_DIRS = [
  "/opt/homebrew/bin", // Apple Silicon Homebrew
  "/usr/local/bin",    // Intel Homebrew + many manual installs
  "/usr/bin",
  "/bin",
] as const;

/**
 * Pure: return `currentPath` with every canonical macOS bin dir guaranteed
 * present. Missing dirs are APPENDED — existing entries keep their precedence,
 * so we never shadow a tool the user deliberately placed earlier. Empty
 * segments are dropped (a stray "::" would otherwise become a "" lookup dir).
 * Non-darwin platforms get the input back unchanged.
 */
export function repairSpawnPath(
  currentPath: string | undefined,
  platform: NodeJS.Platform,
): string {
  if (platform !== "darwin") return currentPath ?? "";

  const entries = (currentPath ?? "").split(":").filter(Boolean);
  const present = new Set(entries);
  const missing = DARWIN_BIN_DIRS.filter((dir) => !present.has(dir));

  return [...entries, ...missing].join(":");
}

/**
 * Mutating + idempotent: repair process.env.PATH in place. Call once as early
 * as possible at daemon boot, BEFORE any provider init or child spawn, so the
 * repaired PATH propagates to every subprocess (and to the background fork,
 * which copies process.env).
 */
export function ensureSpawnPath(): void {
  process.env.PATH = repairSpawnPath(process.env.PATH, process.platform);
}
