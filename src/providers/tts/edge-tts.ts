import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { TtsProvider, TtsRequest, TtsResult } from "./types.js";
import { FFPROBE_BIN } from "../../server/ffmpeg-paths.js";
import { ensureTtsVenv, venvBinPath, PythonMissingError } from "../../infra/python-env.js";

/**
 * Resolves the edge-tts binary path with this precedence:
 *   1. EDGE_TTS_PATH override (dev machines where pipx put it outside PATH)
 *   2. the managed venv at <dataDir>/tts-venv/bin/edge-tts, if present
 *      (provisioned by ensureTtsVenv() — I15)
 *   3. bare "edge-tts" (rely on inherited PATH)
 *
 * The venv path is resolved via the shared python-env helper so the layout
 * (bin/ vs Scripts/, AUTOVIRAL_DATA_DIR root) stays single-sourced with the
 * bootstrap that creates it.
 */
export function resolveEdgeTtsBin(): string {
  if (process.env.EDGE_TTS_PATH) return process.env.EDGE_TTS_PATH;
  const venvBin = venvBinPath("edge-tts");
  if (existsSync(venvBin)) return venvBin;
  return "edge-tts";
}

/**
 * Translates AutoViral's expressive tag dialect into Edge TTS SSML fragments.
 *
 * Tags:
 *   [sigh]               → <break time="400ms"/>
 *   [laughing]           → <break time="600ms"/>
 *   [pause]              → <break time="500ms"/>
 *   [short pause]        → <break time="200ms"/>
 *   [whisper]X[/whisper] → <prosody volume="x-soft">X</prosody>
 *
 * XML-significant characters (& < >) in surrounding text are escaped first so
 * the result can be safely embedded inside an SSML envelope.
 *
 * Pure helper — no I/O. Safe to unit-test.
 */
export function mapExpressiveTagsToSsml(text: string): string {
  let r = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  r = r.replace(/\[sigh\]/gi, '<break time="400ms"/>');
  r = r.replace(/\[laughing\]/gi, '<break time="600ms"/>');
  r = r.replace(/\[short pause\]/gi, '<break time="200ms"/>');
  r = r.replace(/\[pause\]/gi, '<break time="500ms"/>');
  r = r.replace(/\[whisper\]([^[]*?)\[\/whisper\]/gi, '<prosody volume="x-soft">$1</prosody>');
  return r;
}

/**
 * Spawns the `edge-tts` CLI to synthesize audio.
 *
 * Note on SSML: edge-tts 7.2.x exposes only `--text` / `--file` (no
 * `--ssml-string`). The Python package wraps `--text` content into the SSML
 * <speak> envelope server-side, so embedded SSML fragments like
 * <break time="..."/> and <prosody> are typically honored. If a future
 * edge-tts version regresses on this, switch to the `--file` flag with a
 * temp file containing a full SSML document, or to a library call that
 * accepts SSML directly.
 */
async function runEdgeTtsCli(
  text: string,
  voice: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // EDGE_TTS_PATH override / managed venv / bare binary — see resolveEdgeTtsBin.
    const bin = resolveEdgeTtsBin();
    const child = spawn(bin, [
      "--voice",
      voice,
      "--text",
      text,
      "--write-media",
      outputPath,
    ]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts CLI exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function ffprobeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.slice(0, 200)}`));
      const v = parseFloat(out.trim());
      if (Number.isNaN(v)) return reject(new Error(`ffprobe non-numeric: ${out}`));
      resolve(v);
    });
  });
}

export const edgeTtsProvider: TtsProvider = {
  id: "edge-tts",
  name: "Microsoft Edge TTS (multilingual)",
  supportsLanguages: ["zh-CN", "zh-TW", "en-US", "en-GB", "ja-JP", "ko-KR", "es-ES", "fr-FR"],
  voices: [
    {
      id: "zh-CN-XiaoxiaoNeural",
      name: "晓晓 (Chinese, female, conversational)",
      lang: "zh-CN",
      tags: ["female", "warm"],
    },
    {
      id: "zh-CN-YunjianNeural",
      name: "云健 (Chinese, male, calm)",
      lang: "zh-CN",
      tags: ["male", "calm"],
    },
    {
      id: "en-US-AriaNeural",
      name: "Aria (English-US, female, neutral)",
      lang: "en-US",
      tags: ["female", "neutral"],
    },
    {
      id: "en-US-GuyNeural",
      name: "Guy (English-US, male, casual)",
      lang: "en-US",
      tags: ["male", "casual"],
    },
  ],
  async isAvailable(): Promise<boolean> {
    const resolved = resolveEdgeTtsBin();
    // A concrete path must exist on disk; a bare "edge-tts" is presumed
    // available (the registry still catches a runtime ENOENT and falls back).
    return existsSync(resolved) || resolved === "edge-tts";
  },
  async generate(req: TtsRequest): Promise<TtsResult> {
    // Auto-provision the managed venv on a clean machine (I15). Skip when an
    // EDGE_TTS_PATH override is set (a dev pointing at their own binary) — we
    // never want to clobber that with a pip install. ensureTtsVenv() is
    // idempotent + cheap when already provisioned; it throws PythonMissingError
    // when python3 is absent, which we surface as an actionable hint rather than
    // an opaque ENOENT from the bare-name spawn below.
    if (!process.env.EDGE_TTS_PATH) {
      try {
        await ensureTtsVenv();
      } catch (err) {
        if (err instanceof PythonMissingError) throw err;
        // A pip/venv failure is non-fatal HERE: edge-tts may still be on PATH
        // (Homebrew / pipx install). Fall through to the spawn, which will give
        // a clear ENOENT if it truly isn't available.
      }
    }
    const ssml = mapExpressiveTagsToSsml(req.text);
    await runEdgeTtsCli(ssml, req.voice, req.outputPath);
    // Defensive: edge-tts can exit 0 on partial-write / network glitch and
    // leave a 0-byte file. Catch this here rather than letting ffprobe fail
    // with a confusing "non-numeric" error. Mirrors normalizeLufs (3.A) and
    // burnSubtitles (3.B).
    const s = await stat(req.outputPath);
    if (s.size === 0) {
      throw new Error(`edge-tts produced empty file: ${req.outputPath}`);
    }
    const duration = await ffprobeDuration(req.outputPath);
    return {
      outputPath: req.outputPath,
      duration,
      sampleRate: 24000,
      channels: 1,
    };
  },
};
