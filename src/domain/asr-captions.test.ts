// PRD-0014 S9 review finding #2 — a word-timing extraction failure inside the
// transcribe script (`result.all_words()` raised) must NOT be swallowed into an
// empty word list that the caller then misreports as "no speech" with HTTP 200.
// runAsrCaptions shells out to an inline python via execFileAsync; we mock that
// seam (and the venv provisioner) so the test drives the JSON contract directly
// — no stable-ts, no python, mirroring caption-align's fixture-driven precedent.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileAsync } = vi.hoisted(() => ({ execFileAsync: vi.fn() }));
vi.mock("../server/routes/_shared.js", () => ({ execFileAsync }));
vi.mock("../infra/python-env.js", () => ({
  ensureTtsVenv: vi.fn(async () => {}),
  venvPythonPath: () => "python3",
  PythonMissingError: class PythonMissingError extends Error {},
}));

import { runAsrCaptions } from "./asr-captions.js";

function stdout(obj: unknown) {
  return { stdout: JSON.stringify(obj), stderr: "" };
}

describe("runAsrCaptions — word-timing failure is not a false success", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("segments present but all_words() raised → 500 WORD_TIMING_FAILED (not a false no-speech)", async () => {
    execFileAsync.mockResolvedValueOnce(
      stdout({
        segments: [{ start: 0, end: 2, text: "你好世界" }],
        words: [],
        words_error: "word-timing extraction failed: 'WhisperResult' object has no attribute 'all_words'",
      }),
    );
    const res = await runAsrCaptions("/abs/audio.mp3", "zh", { wordLevel: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.code).toBe("WORD_TIMING_FAILED");
      expect(res.error).toMatch(/word-timing/i);
    }
  });

  it("genuinely no speech (no segments, no words, no error) → ok with empty captions", async () => {
    execFileAsync.mockResolvedValueOnce(stdout({ segments: [], words: [] }));
    const res = await runAsrCaptions("/abs/audio.mp3", "zh", { wordLevel: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.captions).toHaveLength(0);
      expect(res.words).toHaveLength(0);
    }
  });

  it("word-level success returns per-word timing", async () => {
    execFileAsync.mockResolvedValueOnce(
      stdout({
        segments: [{ start: 0, end: 1, text: "你好" }],
        words: [
          { start: 0, end: 0.5, text: "你" },
          { start: 0.5, end: 1, text: "好" },
        ],
      }),
    );
    const res = await runAsrCaptions("/abs/audio.mp3", "zh", { wordLevel: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.words).toHaveLength(2);
      expect(res.words![0]!.text).toBe("你");
      expect(res.words![1]!.start).toBeCloseTo(0.5, 6);
    }
  });

  it("a genuine stable-ts import error still surfaces as 503 PYTHON_DEP_MISSING", async () => {
    execFileAsync.mockResolvedValueOnce(
      stdout({ error: "stable-whisper not installed: No module named 'stable_whisper'" }),
    );
    const res = await runAsrCaptions("/abs/audio.mp3", "zh", { wordLevel: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.code).toBe("PYTHON_DEP_MISSING");
    }
  });
});
