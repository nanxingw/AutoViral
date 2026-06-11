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
