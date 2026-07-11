// `autoviral setup` — install the missing dependencies with visible
// progress (I14, PRD-0003 §1). Pairs with `autoviral doctor` (the read-only
// readiness report).
//
// Runs CLIENT-SIDE — no daemon required, no npm postinstall (postinstall is
// fragile and routinely blocked in CI / locked-down envs, per the issue). It:
//   1. copies the vendored ffmpeg/ffprobe into ~/.autoviral/bin (the managed
//      location src/infra/deps.ts resolves first after env/managed);
//   2. provisions ~/.autoviral/tts-venv with edge-tts + stable-ts (python venv
//      + pip), streaming pip output so it never silently stalls;
//
// Every step streams a progress line. Exit code: 1 if a CORE install (ffmpeg/
// ffprobe) failed, else 0 (a TTS failure is reported but doesn't fail
// the whole setup — those degrade a feature, not the core render chain).

import {
  installManagedFfmpeg,
  installTtsVenv,
  type InstallResult,
} from "../deps-probe.js";

// `setup` runs a REAL install (copies binaries, provisions a venv, runs pip) —
// so an unknown flag is dangerous, not harmless: previously `setup --check`
// was SILENTLY accepted and proceeded to install anyway (a bare machine would
// really `pip install` when the user only wanted a dry probe). Reject unknown
// flags BEFORE any install runs (exit 4 + usage, mirroring export.ts:54-57),
// with a pointed hint for `--check` → the read-only probe is `autoviral doctor`.
const KNOWN_FLAGS = new Set<string>();

function rejectUnknownFlags(args: string[]): void {
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    if (KNOWN_FLAGS.has(a)) continue;
    if (a === "--check") {
      process.stderr.write(
        "autoviral setup: unknown flag --check — `setup` always INSTALLS. " +
          "For a read-only readiness probe (no install), run `autoviral doctor`.\n",
      );
    } else {
      process.stderr.write(
        `autoviral setup: unknown flag ${a}\nusage: autoviral setup\n`,
      );
    }
    process.exit(4);
  }
}

const STATUS_GLYPH: Record<InstallResult["status"], string> = {
  installed: "✓",
  already: "✓",
  skipped: "○",
  failed: "✗",
};

export async function setupCommand(args: string[]): Promise<void> {
  // Fail fast on a typo'd / unsupported flag BEFORE we install anything.
  rejectUnknownFlags(args);
  const report = (line: string) => process.stdout.write(`${line}\n`);

  report("autoviral setup — installing dependencies\n");

  // ── 1. core: ffmpeg + ffprobe → ~/.autoviral/bin ──────────────────────────
  report("[1/2] ffmpeg + ffprobe (managed binaries)");
  const ffmpeg = await installManagedFfmpeg((l) => report(l));
  report(`${STATUS_GLYPH[ffmpeg.status]} ffmpeg/ffprobe: ${ffmpeg.detail}\n`);

  // ── 2. TTS venv: edge-tts + stable-ts ─────────────────────────────────────
  report("[2/2] TTS venv (edge-tts + stable-ts)");
  const tts = await installTtsVenv((l) => report(l));
  report(`${STATUS_GLYPH[tts.status]} tts venv: ${tts.detail}\n`);

  // ── summary + exit code ───────────────────────────────────────────────────
  const coreFailed = ffmpeg.status === "failed";
  if (coreFailed) {
    report("Setup finished with a CORE failure — render/export needs ffmpeg. See above.");
    report("Re-run `autoviral doctor` to re-check.");
    process.exitCode = 1;
  } else {
    const ttsNote = tts.status === "failed" ? " (TTS install failed — see above)" : "";
    report(`Setup complete.${ttsNote} Run \`autoviral doctor\` to verify.`);
    process.exitCode = 0;
  }
}
