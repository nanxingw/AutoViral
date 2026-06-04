// `autoviral doctor` — print a readiness table for every external dependency
// AutoViral's core chain needs, with where each resolves and how to fix a gap
// (I14, PRD-0003 §1).
//
// Probes are PURE LOCAL READS (no daemon required) so `autoviral doctor` works
// the instant the binary is on PATH, before any `autoviral start`. It checks:
//   • ffmpeg + ffprobe  — env → managed → vendored → PATH (src/infra/deps.ts)
//   • TTS venv          — edge-tts + stable-ts under ~/.autoviral/tts-venv
//   • playwright        — chromium in the per-platform browsers cache
//   • claude CLI        — presence on $PATH (can't be bundled; report only)
//
// EXIT CODES: non-zero when a CORE dep (ffmpeg/ffprobe) is missing, else 0. A
// missing TTS/playwright/claude is a WARNING (degrades a feature, not the core
// render/export chain) and does NOT fail the exit code — `autoviral setup` (or
// first-use lazy install) handles those.

import {
  probeClaude,
  probeFfmpegBoth,
  probePlaywright,
  probeTts,
  type DepSource,
} from "../deps-probe.js";

const OK = "✓";
const BAD = "✗";
const WARN = "○";

/** Human label for where a binary resolved. */
function sourceLabel(source: DepSource, onPath: boolean): string {
  switch (source) {
    case "env":
      return "env override (FFMPEG_PATH/FFPROBE_PATH)";
    case "managed":
      return "managed (~/.autoviral/bin)";
    case "vendored":
      return "vendored (ffmpeg-static)";
    case "path":
      return onPath ? "system PATH" : "NOT FOUND on PATH";
  }
}

export async function doctorCommand(_args: string[]): Promise<void> {
  const ff = probeFfmpegBoth();
  const tts = probeTts();
  const pw = probePlaywright();
  const claude = probeClaude();

  const rows: string[] = [];
  let coreMissing = false;

  // ── core: ffmpeg + ffprobe ────────────────────────────────────────────────
  for (const probe of [ff.ffmpeg, ff.ffprobe]) {
    const where = sourceLabel(probe.source, probe.onPath);
    if (probe.ok) {
      rows.push(`${OK} ${pad(probe.name)} ${where}`);
      rows.push(`    → ${probe.path}`);
    } else {
      coreMissing = true;
      rows.push(`${BAD} ${pad(probe.name)} ${where}`);
      rows.push("    fix: run `autoviral setup` (installs the vendored binary)");
    }
  }

  // ── TTS venv (edge-tts + stable-ts) — warning, not core ───────────────────
  if (tts.ready) {
    rows.push(`${OK} ${pad("tts venv")} edge-tts + stable-ts ready`);
    rows.push(`    → ${tts.venvDir}`);
  } else {
    const missing = [
      !tts.edgeTts ? "edge-tts" : null,
      !tts.stableTs ? "stable-ts" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    rows.push(`${WARN} ${pad("tts venv")} missing ${missing}`);
    rows.push("    fix: run `autoviral setup` (creates the venv & pip-installs them)");
  }

  // ── playwright chromium — heavy, lazy-installed on first use ───────────────
  if (pw.cached) {
    rows.push(`${OK} ${pad("playwright")} chromium cached`);
    rows.push(`    → ${pw.cacheDir}`);
  } else {
    rows.push(`${WARN} ${pad("playwright")} chromium not installed`);
    rows.push("    note: ~150MB, lazy-installs on first trends scrape (or `autoviral setup --heavy`)");
  }

  // ── claude CLI — cannot be bundled, detect + report ───────────────────────
  if (claude.present) {
    rows.push(`${OK} ${pad("claude CLI")} on PATH`);
    rows.push(`    → ${claude.path}`);
  } else {
    rows.push(`${WARN} ${pad("claude CLI")} not found on PATH`);
    rows.push("    note: required for the Chat panel; install from https://claude.ai/code (can't be bundled)");
  }

  process.stdout.write(`autoviral doctor — dependency readiness\n\n${rows.join("\n")}\n\n`);

  if (coreMissing) {
    process.stdout.write(
      "Core dependency missing (ffmpeg/ffprobe) — render/export/waveform/TTS-probe will fail.\n" +
        "Run `autoviral setup` to install it.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Core dependencies OK.\n");
    process.exitCode = 0;
  }
}

/** Right-pad a dep name to a fixed width so the ✓/✗ table aligns. */
function pad(name: string): string {
  return (name + " ".repeat(12)).slice(0, 12);
}
