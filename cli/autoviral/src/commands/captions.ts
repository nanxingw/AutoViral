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
    const result = await bridgeRequest<{ written: number; language: string | null }>(
      ctx,
      "POST",
      "/captions/generate",
      body,
    );
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
