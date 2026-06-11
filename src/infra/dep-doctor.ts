// `autoviral doctor` / `autoviral setup` for the USER-FACING CLI (I14, PRD-0003 §1).
//
// The npm `bin: autoviral` → dist/index.js → runCLI() in src/cli.ts is a
// commander program. Until this slice it had only start/stop/dashboard/config,
// so a freshly `npm i -g autoviral`'d user typing `autoviral doctor` /
// `autoviral setup` hit commander's "unknown command" and never reached the
// readiness table / installer — even though the daemon's own boot hint
// (src/server/index.ts.warnIfCoreDepsMissing) tells them to run exactly those.
//
// CRUCIAL difference from the bridge CLI's mirror (cli/autoviral/src/deps-probe.ts):
// that file is a self-contained tsup bundle that CAN'T import src/infra (it would
// bloat the agent bundle + fire env side-effects), so it re-implements the
// resolution contract. THIS module is part of the SAME bundle as the daemon, so
// it imports the REAL src/infra/deps.ts (detect / ensureManaged / managedPathFor)
// and src/infra/python-env.ts (ttsVenvReady / ttsVenvDir / venvBinPath /
// ensureTtsVenv / ensurePlaywrightChromium) DIRECTLY — single source of truth,
// zero drift. No probe logic is duplicated; the only thing we compute here is
// "is a bare-name binary actually on PATH" (the same cheap sweep server/index.ts
// already does) and the playwright browsers-cache read (python-env keeps its
// chromium-cache read private; it's display-only here and the real install path
// goes through ensurePlaywrightChromium()).
//
// Both run CLIENT-SIDE — pure local reads (doctor) / installers (setup), no
// daemon required. Dependencies are injected so unit tests never copy ffmpeg,
// create a venv, or hit PyPI.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { detect, ensureManaged, type DepName } from "./deps.js";
import {
  ensurePlaywrightChromium,
  ensureTtsVenv,
  ttsVenvDir,
  ttsVenvReady,
  venvBinPath,
} from "./python-env.js";
import {
  collectorVenvDir,
  collectorVenvReady,
  ensureCollectorVenv,
} from "./collector-env.js";
import { REMOTION_ENTRY_POINT } from "./paths.js";

const OK = "✓";
const BAD = "✗";
const WARN = "○";

/** Sink for human-readable output — injected so tests can capture instead of
 *  writing to the real stdout. */
export type Reporter = (line: string) => void;
const stdout: Reporter = (line) => process.stdout.write(`${line}\n`);

/** Right-pad a dep name to a fixed width so the ✓/✗ table aligns. */
function pad(name: string): string {
  return (name + " ".repeat(12)).slice(0, 12);
}

/** Cheap synchronous check: does `name` resolve on $PATH? No spawn (so doctor
 *  never blocks); mirrors src/server/index.ts.binaryOnPath() exactly. */
function binaryOnPath(name: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, `${name}${ext}`))) return true;
    }
  }
  return false;
}

/** Absolute path to the resolved `claude` binary on $PATH, or null. claude can't
 *  be bundled (proprietary CLI) — we detect + report only. */
function resolveClaude(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = join(dir, `claude${ext}`);
      if (existsSync(cand)) return cand;
    }
  }
  return null;
}

/** Per-platform Playwright browsers cache dir — same contract python-env.ts uses
 *  internally (it keeps its copy private). Display-only: doctor reports whether a
 *  chromium build is cached; the real install goes through ensurePlaywrightChromium(). */
function playwrightCacheDir(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override.trim()) return override;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".cache"), "ms-playwright");
}

/** True when a chromium build already sits in the Playwright browsers cache.
 *  Pure read; never spawns. */
function chromiumCached(): boolean {
  try {
    return readdirSync(playwrightCacheDir()).some((e) => e.startsWith("chromium"));
  } catch {
    return false; // cache dir absent → nothing installed.
  }
}

/** D1 (PRD-0009 E2E): whether the Remotion render entry resolves — either a
 *  pre-built bundle dir (AUTOVIRAL_REMOTION_BUNDLE, packaged app) or the
 *  web/src source checkout (sibling of dist/, dev + repo daemon). Without one
 *  of these, render/export/snapshot fail 100% — doctor used to say "Core
 *  dependencies OK" while every render job died on a webpack ENOENT. */
export interface RemotionEntryProbe {
  ready: boolean;
  via: "bundle" | "source" | null;
  /** The path that resolved (ready) or the path we looked for (missing). */
  path: string;
}

function probeRemotionEntry(): RemotionEntryProbe {
  const prebuilt = process.env.AUTOVIRAL_REMOTION_BUNDLE;
  if (prebuilt && prebuilt.trim() && existsSync(prebuilt.trim())) {
    return { ready: true, via: "bundle", path: prebuilt.trim() };
  }
  if (existsSync(REMOTION_ENTRY_POINT)) {
    return { ready: true, via: "source", path: REMOTION_ENTRY_POINT };
  }
  return { ready: false, via: null, path: REMOTION_ENTRY_POINT };
}

/** Human label for where a binary resolved (deps.ts DepResolution.source). */
function sourceLabel(source: string): string {
  switch (source) {
    case "env":
      return "env override (FFMPEG_PATH/FFPROBE_PATH)";
    case "managed":
      return "managed (~/.autoviral/bin)";
    case "vendored":
      return "vendored (ffmpeg-static)";
    default:
      return "system PATH";
  }
}

/** Dependencies injected for tests — defaults are the REAL src/infra modules so
 *  production wiring needs no arguments. */
export interface DoctorDeps {
  detect: typeof detect;
  ttsVenvReady: typeof ttsVenvReady;
  ttsVenvDir: typeof ttsVenvDir;
  venvBinPath: typeof venvBinPath;
  /** Whether a core bare-name binary resolves on $PATH (only consulted at the
   *  "path" tier). Injected so a missing-ffmpeg case is unit-testable. */
  binaryOnPath: (name: string) => boolean;
  chromiumCached: () => boolean;
  resolveClaude: () => string | null;
  /** Whether the managed Douyin-collector venv (f2 + browser_cookie3) is
   *  provisioned. Injected so the present/missing report is unit-testable. */
  collectorVenvReady: typeof collectorVenvReady;
  collectorVenvDir: typeof collectorVenvDir;
  /** D1: Remotion render-entry probe (bundle env or web/src sibling). Injected
   *  so the missing-entry → exit-1 case is unit-testable. */
  remotionEntry: () => RemotionEntryProbe;
  out: Reporter;
}

const realDoctorDeps: DoctorDeps = {
  detect,
  ttsVenvReady,
  ttsVenvDir,
  venvBinPath,
  binaryOnPath,
  chromiumCached,
  resolveClaude,
  collectorVenvReady,
  collectorVenvDir,
  remotionEntry: probeRemotionEntry,
  out: stdout,
};

/**
 * Print a dependency-readiness table for ffmpeg/ffprobe (the core render chain),
 * the TTS venv (edge-tts + stable-ts), playwright chromium, and the claude CLI,
 * each with where it resolves and how to fix a gap.
 *
 * Returns exit code 1 IFF a CORE dependency (ffmpeg/ffprobe) is unspawnable —
 * i.e. it resolved only to a bare PATH name that isn't actually on $PATH. A
 * missing TTS/playwright/claude is a WARNING (degrades a feature, not the core
 * chain) and does NOT change the exit code; `autoviral setup` (or first-use lazy
 * install) handles those.
 */
export async function runDoctor(deps: Partial<DoctorDeps> = {}): Promise<number> {
  const d = { ...realDoctorDeps, ...deps };
  const resolution = d.detect();
  const rows: string[] = [];
  let coreMissing = false;

  // ── core: ffmpeg + ffprobe ─────────────────────────────────────────────────
  for (const name of ["ffmpeg", "ffprobe"] as DepName[]) {
    const r = resolution[name];
    // env/managed/vendored are reliably spawnable (absolute paths); a bare-name
    // "path" source is only spawnable when the name truly resolves on $PATH.
    const spawnable = r.source !== "path" || d.binaryOnPath(name);
    if (spawnable) {
      rows.push(`${OK} ${pad(name)} ${sourceLabel(r.source)}`);
      rows.push(`    → ${r.path}`);
    } else {
      coreMissing = true;
      rows.push(`${BAD} ${pad(name)} NOT FOUND on PATH`);
      rows.push("    fix: run `autoviral setup` (installs the vendored binary)");
    }
  }

  // ── core: Remotion render entry (render/export/snapshot) ───────────────────
  // D1: a bare dist daemon without AUTOVIRAL_REMOTION_BUNDLE and without a
  // web/src checkout cannot render AT ALL. Part of the core chain — a miss
  // flips the exit code, so doctor can never again report "Core dependencies
  // OK" while every render job fails.
  const entry = d.remotionEntry();
  if (entry.ready) {
    rows.push(
      `${OK} ${pad("remotion")} render entry — ${
        entry.via === "bundle"
          ? "pre-built bundle (AUTOVIRAL_REMOTION_BUNDLE)"
          : "web/src source checkout"
      }`,
    );
    rows.push(`    → ${entry.path}`);
  } else {
    coreMissing = true;
    rows.push(
      `${BAD} ${pad("remotion")} render entry NOT FOUND — render/export/snapshot will fail`,
    );
    rows.push(`    looked for: ${entry.path}`);
    rows.push(
      "    fix: set AUTOVIRAL_REMOTION_BUNDLE to a pre-built bundle dir, or run the daemon from a checkout containing web/src",
    );
  }

  // ── TTS venv (edge-tts + stable-ts) — warning, not core ────────────────────
  if (d.ttsVenvReady()) {
    rows.push(`${OK} ${pad("tts venv")} edge-tts + stable-ts ready`);
    rows.push(`    → ${d.ttsVenvDir()}`);
  } else {
    const missing = [
      existsSync(d.venvBinPath("edge-tts")) ? null : "edge-tts",
      "stable-ts", // stableTs presence isn't a public read; setup back-fills it
    ]
      .filter(Boolean)
      .join(" + ");
    rows.push(`${WARN} ${pad("tts venv")} not ready (missing ${missing})`);
    rows.push("    fix: run `autoviral setup` (creates the venv & pip-installs them)");
  }

  // ── collector venv (f2 + browser_cookie3) — warning, not core ──────────────
  // The Douyin analytics collector's managed deps. Reported honestly so a missing
  // dep surfaces here instead of a silent ENOENT when refresh is wired (S5).
  if (d.collectorVenvReady()) {
    rows.push(`${OK} ${pad("collector")} f2 + browser_cookie3 ready`);
    rows.push(`    → ${d.collectorVenvDir()}`);
  } else {
    rows.push(`${WARN} ${pad("collector")} not ready (missing f2 + browser_cookie3)`);
    rows.push("    fix: run `autoviral setup` (creates the venv & pip-installs them)");
  }

  // ── playwright chromium — heavy, lazy-installed on first use ────────────────
  if (d.chromiumCached()) {
    rows.push(`${OK} ${pad("playwright")} chromium cached`);
  } else {
    rows.push(`${WARN} ${pad("playwright")} chromium not installed`);
    rows.push("    note: ~150MB, lazy-installs on first trends scrape (or `autoviral setup --heavy`)");
  }

  // ── claude CLI — cannot be bundled, detect + report ────────────────────────
  const claudePath = d.resolveClaude();
  if (claudePath) {
    rows.push(`${OK} ${pad("claude CLI")} on PATH`);
    rows.push(`    → ${claudePath}`);
  } else {
    rows.push(`${WARN} ${pad("claude CLI")} not found on PATH`);
    rows.push("    note: required for the Chat panel; install from https://claude.ai/code (can't be bundled)");
  }

  d.out(`autoviral doctor — dependency readiness\n\n${rows.join("\n")}\n`);

  if (coreMissing) {
    d.out(
      "Core dependency missing (ffmpeg/ffprobe/remotion entry) — render/export/waveform will fail.\n" +
        "See the ✗ rows above for the exact fix.",
    );
    return 1;
  }
  d.out("Core dependencies OK.");
  return 0;
}

// ── setup ────────────────────────────────────────────────────────────────────

export interface SetupOpts {
  /** Install playwright chromium (~150MB) now instead of lazy-on-first-use. */
  heavy?: boolean;
}

/** Dependencies injected for tests — defaults call the REAL provisioners. */
export interface SetupDeps {
  ensureManaged: typeof ensureManaged;
  ensureTtsVenv: typeof ensureTtsVenv;
  /** Provisions the managed Douyin-collector venv (f2 + browser_cookie3). */
  ensureCollectorVenv: typeof ensureCollectorVenv;
  ensurePlaywrightChromium: typeof ensurePlaywrightChromium;
  /** Post-install readiness probe for the core binaries (mirrors runDoctor). */
  detect: typeof detect;
  binaryOnPath: (name: string) => boolean;
  out: Reporter;
}

const realSetupDeps: SetupDeps = {
  ensureManaged,
  ensureTtsVenv,
  ensureCollectorVenv,
  ensurePlaywrightChromium,
  detect,
  binaryOnPath,
  out: stdout,
};

/**
 * Install the missing pieces with streamed progress:
 *   1. ensureManaged() copies the vendored ffmpeg/ffprobe into ~/.autoviral/bin;
 *   2. ensureTtsVenv() provisions the TTS python venv (edge-tts + stable-ts);
 *   3. ensureCollectorVenv() provisions the Douyin-collector venv (f2 +
 *      browser_cookie3);
 *   4. playwright chromium — lazy by default (just a note), or ensurePlaywright-
 *      Chromium() now with `--heavy`.
 *
 * Returns exit code 1 ONLY when the CORE step (ffmpeg/ffprobe) leaves the
 * binaries unspawnable; a TTS / collector / playwright failure is reported but
 * doesn't fail the whole setup (those degrade a feature, not the core render
 * chain). Mirrors the bridge CLI's setup exit-code semantics.
 */
export async function runSetup(
  opts: SetupOpts = {},
  deps: Partial<SetupDeps> = {},
): Promise<number> {
  const d = { ...realSetupDeps, ...deps };
  d.out("autoviral setup — installing dependencies\n");

  // ── 1. core: ffmpeg + ffprobe → ~/.autoviral/bin ───────────────────────────
  d.out("[1/3] ffmpeg + ffprobe (managed binaries)");
  let coreFailed = false;
  try {
    await d.ensureManaged();
    // ensureManaged is best-effort and never throws; re-probe to confirm the
    // core binaries are now spawnable (same logic as runDoctor).
    const resolution = d.detect();
    for (const name of ["ffmpeg", "ffprobe"] as DepName[]) {
      const r = resolution[name];
      const spawnable = r.source !== "path" || d.binaryOnPath(name);
      if (!spawnable) coreFailed = true;
    }
    d.out(
      coreFailed
        ? `${BAD} ffmpeg/ffprobe: still unspawnable (no vendored binary and not on PATH)\n`
        : `${OK} ffmpeg/ffprobe: ready\n`,
    );
  } catch (e) {
    coreFailed = true;
    d.out(`${BAD} ffmpeg/ffprobe: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // ── 2. TTS venv: edge-tts + stable-ts ──────────────────────────────────────
  d.out("[2/4] TTS venv (edge-tts + stable-ts)");
  let ttsFailed = false;
  try {
    await d.ensureTtsVenv();
    d.out(`${OK} tts venv: edge-tts + stable-ts ready\n`);
  } catch (e) {
    ttsFailed = true;
    d.out(`${WARN} tts venv: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // ── 3. collector venv: f2 + browser_cookie3 ────────────────────────────────
  d.out("[3/4] collector venv (f2 + browser_cookie3)");
  let collectorFailed = false;
  try {
    await d.ensureCollectorVenv();
    d.out(`${OK} collector venv: f2 + browser_cookie3 ready\n`);
  } catch (e) {
    collectorFailed = true;
    d.out(`${WARN} collector venv: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // ── 4. playwright chromium: heavy, lazy by default ─────────────────────────
  if (opts.heavy) {
    d.out("[4/4] playwright chromium (--heavy)");
    try {
      await d.ensurePlaywrightChromium({ onProgress: (l) => d.out(`  ${l}`) });
      d.out(`${OK} chromium: ready\n`);
    } catch (e) {
      d.out(`${WARN} chromium: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  } else {
    d.out("[4/4] playwright chromium");
    d.out(
      `${WARN} chromium: lazy-installs (~150MB) on first trends scrape — pass --heavy to install now\n`,
    );
  }

  // ── summary + exit code ────────────────────────────────────────────────────
  if (coreFailed) {
    d.out("Setup finished with a CORE failure — render/export needs ffmpeg. See above.");
    d.out("Re-run `autoviral doctor` to re-check.");
    return 1;
  }
  const notes = [
    ttsFailed ? "TTS install failed" : null,
    collectorFailed ? "collector install failed" : null,
  ].filter(Boolean);
  const note = notes.length ? ` (${notes.join("; ")} — see above)` : "";
  d.out(`Setup complete.${note} Run \`autoviral doctor\` to verify.`);
  return 0;
}
