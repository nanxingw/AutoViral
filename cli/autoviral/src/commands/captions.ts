// `autoviral captions generate [--language L] [--asset <relpath>]` — ASR
// caption write surface.
//
// S14 (US 20/21). Round-trips through the bridge `POST /captions/generate`,
// which runs the SAME stable-ts transcription core the `/api/audio/captions`
// route uses, then writes each timecoded segment as a TextClip into the text
// track (atomic + composition-changed broadcast). So an agent running
// `autoviral captions generate` and a human clicking the Studio "生成字幕"
// button converge on the same composition.
//
// Default audio source is the first audio-track clip in the composition; pass
// `--asset assets/voice.mp3` to transcribe a specific work-relative file.
// Prints the number of caption clips written. A missing whisper venv surfaces as
// the bridge's 503 PYTHON_DEP_MISSING → exit 3 (a service/env error, not a bad
// invocation).

import { readFile } from "node:fs/promises";
import { bridgeRequest, readContext } from "../client.js";

export async function captionsCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "generate") {
    const opts = parseFlags(rest);
    const body: Record<string, unknown> = {};
    if (opts["--language"]) body.language = opts["--language"];
    if (opts["--asset"]) body.assetPath = opts["--asset"];
    if (opts["--track-id"]) body.trackId = opts["--track-id"];
    // PRD-0014 S9 — `--script <file>`: align ASR word timing to the
    // GROUND-TRUTH script text (the bridge does the LCS-level coarse align →
    // CJK line-split → CaptionModel). We read the file HERE so a missing path
    // is a caller error (exit 4) that never touches the bridge — no half-written
    // caption model. The text goes on the wire as `script`; `--max-cjk-chars`
    // (default 14) sets the per-line CJK cap the bridge splits at.
    // S9 review finding #5 — validate on FLAG PRESENCE, not truthiness. A bare
    // `--script` (no path) used to leave `opts["--script"]` undefined, so the
    // whole block was skipped and the call silently degraded to the legacy
    // ASR→TextClip path — the caller asked for aligned captions and got none.
    // A present-but-valueless flag is a caller error (exit 4), never a fallback.
    if ("--script" in opts) {
      const scriptPath = opts["--script"];
      if (!scriptPath || scriptPath.startsWith("--")) {
        process.stderr.write(
          "autoviral: --script needs a file path (e.g. --script plan/script.md)\n",
        );
        process.exit(4);
      }
      let scriptText: string;
      try {
        scriptText = await readFile(scriptPath, "utf8");
      } catch (err) {
        process.stderr.write(
          `autoviral: --script file not found or unreadable: ${scriptPath} — ${(err as Error).message}\n`,
        );
        process.exit(4);
      }
      // An empty / whitespace-only script cannot align to anything. Reject it
      // here rather than let it fall through to the ASR→TextClip path (which
      // would produce no CaptionModel and look like a silent success).
      if (scriptText.trim().length === 0) {
        process.stderr.write(
          `autoviral: --script file is empty or whitespace-only: ${scriptPath}\n`,
        );
        process.exit(4);
      }
      body.script = scriptText;
      const rawMax = opts["--max-cjk-chars"];
      let maxCjkChars = 14;
      if (rawMax !== undefined) {
        const n = Number(rawMax);
        if (!Number.isFinite(n) || n <= 0) {
          process.stderr.write(
            `autoviral: --max-cjk-chars must be a positive number, got "${rawMax}"\n`,
          );
          process.exit(4);
        }
        maxCjkChars = Math.floor(n);
      }
      body.maxCjkChars = maxCjkChars;
    }
    // bridgeRequest owns the error→exit-code contract: a 4xx envelope (e.g.
    // "no audio source", 400 code:4) exits 4 and a 5xx (503 PYTHON_DEP_MISSING /
    // 500 API_ERROR) exits 3 BEFORE this line runs — they never reach the print
    // below. So if we get here the call truly succeeded (HTTP 200 ok:true).
    const result = await bridgeRequest<{
      written: number;
      language: string | null;
      message?: string;
    }>(ctx, "POST", "/captions/generate", body);
    // Zero-segment success (silence / no detectable speech) comes back as a
    // 200 ok:true with written:0 + an explanatory `message`. Surface that
    // message on stderr so an agent doesn't read a bare `0` (exit 0) as a
    // generic success — it's "nothing was written", a meaningfully different
    // state than "wrote N captions". The count still prints to stdout (the
    // machine-readable result); exit stays 0 because the request itself was
    // well-formed and the bridge succeeded.
    if (result.written === 0 && result.message) {
      process.stderr.write(`autoviral: ${result.message}\n`);
    }
    process.stdout.write(`${result.written}\n`);
    return;
  }

  process.stderr.write(`autoviral captions: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k] = argv[i + 1];
      i++;
    }
  }
  return out;
}
