// S14 (US 20/21) — ASR caption core, extracted from the inline body of
// `POST /api/audio/captions` so BOTH that route AND the bridge
// `POST /captions/generate` share one implementation. `runAsrCaptions` takes an
// ALREADY-RESOLVED absolute audio path (callers own path-traversal hardening)
// and returns a discriminated result the callers map to their own envelopes:
//   { ok: true, captions: [{start, end, text}, ...] }
//   { ok: false, status, code, error }   (e.g. 503 PYTHON_DEP_MISSING / 500 API_ERROR)
//
// No HTTP, no path resolution, no zod here — this is the ASR side-effect only.
// stable_whisper imports under the venv interpreter ensureTtsVenv() provisions;
// when stable-ts isn't installed the inline python prints {"error": ...} on
// stdout (exit 0) rather than crashing, so we surface PYTHON_DEP_MISSING (503)
// instead of an opaque 500. (R45: the PyPI package is `stable-ts`; the import
// alias is `stable_whisper` for legacy reasons.)

import {
  ensureTtsVenv,
  venvPythonPath,
  PythonMissingError,
} from "../infra/python-env.js";
import { execFileAsync } from "../server/routes/_shared.js";

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

export type AsrCaptionsResult =
  | { ok: true; captions: CaptionSegment[]; words?: CaptionSegment[] }
  | { ok: false; status: 500 | 503; code: string; error: string };

export async function runAsrCaptions(
  absAudioPath: string,
  language?: string,
  // PRD-0014 S9 — when `wordLevel` is set, also transcribe WORD timestamps
  // (`word_timestamps=True` → `result.all_words()`) and return them as `words`.
  // The `--script` alignment path needs per-word anchors; the legacy segment
  // path (default) is untouched so existing callers keep their behaviour.
  opts?: { wordLevel?: boolean },
): Promise<AsrCaptionsResult> {
  // Auto-provision the managed venv (I15) so a clean machine has stable-ts
  // without a manual `pip install`. Idempotent + cheap once provisioned;
  // throws PythonMissingError when python3 itself is absent, which we surface
  // as the existing PYTHON_DEP_MISSING 503 contract instead of an opaque 500.
  try {
    await ensureTtsVenv();
  } catch (err) {
    if (err instanceof PythonMissingError) {
      return { ok: false, status: 503, code: "PYTHON_DEP_MISSING", error: err.message };
    }
    // A venv/pip failure is non-fatal here — stable_whisper may still be
    // importable under the host python3. Fall through and let the import
    // probe below report PYTHON_DEP_MISSING if it really is missing.
  }

  // Shell out to a small inline python that calls stable_whisper.transcribe and
  // dumps timecoded segments as JSON on stdout.
  const wordLevel = opts?.wordLevel === true;
  const py = `
import json, sys
try:
    import stable_whisper
except Exception as e:
    print(json.dumps({"error": "stable-whisper not installed: " + str(e)}), file=sys.stdout)
    sys.exit(0)
model = stable_whisper.load_model("base")
result = model.transcribe(${JSON.stringify(absAudioPath)}${language ? `, language=${JSON.stringify(language)}` : ""}${wordLevel ? ", word_timestamps=True" : ""})
segs = []
for s in result.segments:
    segs.append({"start": float(s.start), "end": float(s.end), "text": s.text.strip()})
out = {"segments": segs}
${wordLevel ? `words = []
words_error = None
try:
    for w in result.all_words():
        t = (w.word or "").strip()
        if t:
            words.append({"start": float(w.start), "end": float(w.end), "text": t})
except Exception as e:
    # A word-timing extraction failure must NOT be swallowed into an empty list
    # that the route then misreports as "no speech" — surface it so the caller
    # sees a real failure (S9 review finding #2).
    words_error = "word-timing extraction failed: " + str(e)
out["words"] = words
if words_error is not None:
    out["words_error"] = words_error` : ""}
print(json.dumps(out))
`;
  try {
    // Run under the venv interpreter (where ensureTtsVenv installed stable-ts);
    // venvPythonPath() falls back to bare "python3" when the venv is absent.
    const { stdout } = await execFileAsync(venvPythonPath(), ["-c", py], {
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      return {
        ok: false,
        status: 503,
        // R45 — package name on PyPI is `stable-ts` (the import alias is
        // `stable_whisper` for legacy reasons). The original `pip install
        // stable-whisper` hint is wrong: that package doesn't exist on PyPI
        // and pip 404s. Burned ~5 minutes 2026-05-09 chasing this.
        code: "PYTHON_DEP_MISSING",
        error: `${parsed.error}. Run \`pip install stable-ts\` to enable ASR (the import is named stable_whisper but the PyPI package is stable-ts).`,
      };
    }
    // S9 review finding #2 — `result.all_words()` raised inside the transcribe
    // script (word timing unavailable for this model/version). The inline python
    // reports it as `words_error` instead of returning an empty word list, so we
    // propagate a real 500 rather than let the route see `words:[]` and falsely
    // report "no speech" with HTTP 200.
    if (wordLevel && typeof parsed.words_error === "string") {
      return {
        ok: false,
        status: 500,
        code: "WORD_TIMING_FAILED",
        error: String(parsed.words_error),
      };
    }
    const captions: CaptionSegment[] = (parsed.segments ?? []).map((s: any) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text ?? ""),
    }));
    const words: CaptionSegment[] | undefined = wordLevel
      ? (parsed.words ?? []).map((w: any) => ({
          start: Number(w.start),
          end: Number(w.end),
          text: String(w.text ?? ""),
        }))
      : undefined;
    return words ? { ok: true, captions, words } : { ok: true, captions };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      code: "API_ERROR",
      error: err?.stderr ?? err?.message ?? "ASR failed",
    };
  }
}
