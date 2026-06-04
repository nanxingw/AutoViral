// Shared dependency-manager — PRD-0003 §1, slice I13.
//
// AutoViral's core chain (render / export / waveform / TTS duration-probe)
// spawns external binaries. Historically those were spawned BY BARE NAME
// ("ffmpeg" / "ffprobe"), which made them hostage to the daemon's inherited
// shell PATH — a non-login-shell launch (Electron .app double-click, launchd,
// agent harness) drops /opt/homebrew/bin and every spawn fails with an opaque
// ENOENT even though the tool is installed. See PRD-0003 §1 and the runtime
// investigation (2026-06-04).
//
// This module resolves ffmpeg/ffprobe from a KNOWN location instead of trusting
// PATH, with a deterministic precedence:
//
//   (1) env override   — FFMPEG_PATH / FFPROBE_PATH (packaged app points these
//                        at bundled binaries; highest precedence, unchanged).
//   (2) managed        — ~/.autoviral/bin/ffmpeg[.exe] / ffprobe[.exe] if it
//                        exists. The "managed location" contract I14's doctor
//                        detects; populated best-effort by ensureManaged().
//   (3) vendored       — ffmpeg-static / @ffprobe-installer/ffprobe shipped in
//                        node_modules. THIS IS THE TRACER WIN: the vendored
//                        binary is an absolute path that works under a stripped
//                        PATH with zero system install.
//   (4) bare name      — "ffmpeg" / "ffprobe" resolved against PATH. Last
//                        resort, kept so ensureSpawnPath()'s Homebrew append
//                        (commit bcc39c2) still rescues a host install if the
//                        vendored package is somehow unavailable.
//
// Resolution is lazy + cached: the first call computes the path and memoises it.
// ensureManaged() is best-effort and idempotent — a failed copy NEVER throws on
// a render path; the resolver just keeps using the vendored absolute path.

import { existsSync } from "node:fs";
import { copyFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { dataDir } from "./config.js";

const require = createRequire(import.meta.url);

export type DepName = "ffmpeg" | "ffprobe";

/** How a binary path was resolved — surfaced by detect() for I14's doctor. */
export type DepSource = "env" | "managed" | "vendored" | "path";

export interface DepResolution {
  /** The resolved invocation string passed to child_process spawn/execFile. */
  path: string;
  /** Which precedence tier produced `path`. */
  source: DepSource;
  /** Absolute path of the managed copy (whether or not it exists yet). */
  managedPath: string;
  /** Whether the managed copy currently exists on disk. */
  managedExists: boolean;
  /** Absolute path of the vendored binary, or null if unresolvable. */
  vendoredPath: string | null;
}

/** Managed binaries live under ~/.autoviral/bin (honours AUTOVIRAL_DATA_DIR via
 *  dataDir, so tests stay isolated). */
function managedBinDir(): string {
  return join(dataDir, "bin");
}

/** Platform-correct executable filename for a managed/copied binary. */
function exeName(name: DepName): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/** Absolute path of the managed copy for `name` (may not exist yet). */
export function managedPathFor(name: DepName): string {
  return join(managedBinDir(), exeName(name));
}

/** Env var that, when set, overrides resolution for `name` (packaged app). */
function envOverride(name: DepName): string | undefined {
  const v = name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  return v && v.trim() ? v : undefined;
}

/**
 * Absolute path of the vendored binary, or null if the package is unavailable
 * / unsupported on this platform. Wrapped in try/catch so a missing or broken
 * vendored package can never crash the resolver — we just fall through to PATH.
 *
 * NB: ffmpeg-static's default export IS the path string; @ffprobe-installer's
 * default export is an object with a `.path`. ffmpeg-static reads its OWN env
 * var `FFMPEG_BIN` first (note: NOT one of ours) — we never set that env var,
 * so the bundled path is what we get.
 */
export function vendoredPathFor(name: DepName): string | null {
  try {
    if (name === "ffmpeg") {
      const p = require("ffmpeg-static") as string | null;
      return p && typeof p === "string" ? p : null;
    }
    const mod = require("@ffprobe-installer/ffprobe") as { path?: string } | null;
    return mod && typeof mod.path === "string" ? mod.path : null;
  } catch {
    return null;
  }
}

// ── Resolution (lazy + cached) ───────────────────────────────────────────────

const cache = new Map<DepName, string>();

/**
 * Resolve `name` to a spawnable string, applying the precedence above. The
 * result is memoised: the managed dir is checked once, so a copy that lands
 * AFTER first resolution doesn't change an already-resolved value (the vendored
 * absolute path is equally correct — the managed copy exists for doctor
 * detection, not for correctness).
 *
 * resolve() is a PURE READ — it never writes to disk. Populating the managed
 * location is the explicit job of ensureManaged(), called once at daemon boot
 * (startServer). Keeping resolution side-effect-free means merely IMPORTING a
 * spawn-site module never triggers an ~80MB binary copy (which would be a nasty
 * surprise in unit tests and CLI subcommands).
 */
function resolve(name: DepName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const resolved = computeResolution(name);
  cache.set(name, resolved.path);
  return resolved.path;
}

/** Pure-ish resolver core — computes the full DepResolution without caching. */
function computeResolution(name: DepName): DepResolution {
  const managedPath = managedPathFor(name);
  const managedExists = existsSync(managedPath);
  const vendoredPath = vendoredPathFor(name);

  const override = envOverride(name);
  let path: string;
  let source: DepSource;
  if (override) {
    path = override;
    source = "env";
  } else if (managedExists) {
    path = managedPath;
    source = "managed";
  } else if (vendoredPath) {
    path = vendoredPath;
    source = "vendored";
  } else {
    path = name; // bare name → PATH (last resort)
    source = "path";
  }

  return { path, source, managedPath, managedExists, vendoredPath };
}

/** Resolved ffmpeg invocation string. Sync + cached. */
export function getFfmpegPath(): string {
  return resolve("ffmpeg");
}

/** Resolved ffprobe invocation string. Sync + cached. */
export function getFfprobePath(): string {
  return resolve("ffprobe");
}

// ── detect() — diagnostics for I14's doctor ──────────────────────────────────

/** Full resolution diagnostics for both binaries (no caching, always fresh). */
export function detect(): Record<DepName, DepResolution> {
  return {
    ffmpeg: computeResolution("ffmpeg"),
    ffprobe: computeResolution("ffprobe"),
  };
}

// ── ensureManaged() — populate the managed location (best-effort) ─────────────

let managedInFlight: Promise<void> | null = null;

/**
 * Copy the vendored ffmpeg/ffprobe binaries into ~/.autoviral/bin so the
 * "managed location" contract is real (I14's doctor detects them there).
 *
 * Idempotent: skips a binary whose managed copy already exists. Best-effort:
 * a failed copy is swallowed — callers on a render path MUST NOT have their work
 * interrupted just because the managed copy failed; the resolver falls back to
 * the vendored absolute path. Concurrent calls share one in-flight promise so a
 * burst of callers doesn't copy N times.
 */
export async function ensureManaged(): Promise<void> {
  if (managedInFlight) return managedInFlight;
  managedInFlight = (async () => {
    try {
      const dir = managedBinDir();
      await mkdir(dir, { recursive: true });
      for (const name of ["ffmpeg", "ffprobe"] as const) {
        const dest = managedPathFor(name);
        if (existsSync(dest)) continue; // idempotent
        const src = vendoredPathFor(name);
        if (!src || !existsSync(src)) continue; // nothing to copy — leave tier (3)/(4)
        try {
          await copyFile(src, dest);
          // Vendored binaries are already +x, but copyFile preserves mode only
          // on some platforms — force it so the managed copy is spawnable.
          if (process.platform !== "win32") await chmod(dest, 0o755);
          // A managed copy now exists; drop the cached resolution so the next
          // getFfmpegPath()/getFfprobePath() picks up tier (2).
          cache.delete(name);
        } catch {
          // best-effort: one binary failing must not abort the other
        }
      }
    } catch {
      // best-effort: never throw out of ensureManaged()
    } finally {
      managedInFlight = null;
    }
  })();
  return managedInFlight;
}

/** Test-only: clear the resolution cache + in-flight guard so precedence tests
 *  can re-resolve under a freshly mutated env / filesystem. */
export function _resetDepsCacheForTests(): void {
  cache.clear();
  managedInFlight = null;
}
