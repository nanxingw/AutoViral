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

  // PRD-0014 S18 finding B [high] — with no `--language` pinned, whisper
  // auto-detects and prints "Detecting language…" / "Detected language: Chinese"
  // to STDOUT, polluting the single json.dumps line the inline python emits.
  // `JSON.parse(whole stdout)` then throws → the route 500s (`captions generate
  // --script` without --language crashed in the recon E2E D6). The node side must
  // recover the trailing JSON regardless of the banner (same family as the repo's
  // historic "captions 500 stdout 污染").
  it("tolerates whisper 'Detected language' stdout banner before the JSON (S18 B — no 500)", async () => {
    const payload = { segments: [{ start: 0, end: 2, text: "内存条" }] };
    execFileAsync.mockResolvedValueOnce({
      stdout:
        "Detecting language using up to the first 30 seconds...\n" +
        "Detected language: Chinese\n" +
        JSON.stringify(payload) +
        "\n",
      stderr: "",
    });
    const res = await runAsrCaptions("/abs/audio.mp3"); // no language → auto-detect
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.captions).toHaveLength(1);
      expect(res.captions[0]!.text).toBe("内存条");
    }
  });

  it("word-level path also survives the banner (picks the trailing JSON with words)", async () => {
    const payload = {
      segments: [{ start: 0, end: 1, text: "你好" }],
      words: [{ start: 0, end: 1, text: "你好" }],
    };
    execFileAsync.mockResolvedValueOnce({
      stdout: "Detected language: Chinese\n" + JSON.stringify(payload),
      stderr: "",
    });
    const res = await runAsrCaptions("/abs/audio.mp3", undefined, { wordLevel: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.words).toHaveLength(1);
  });

  it("stdout with no JSON object at all → 500 API_ERROR (not a crash)", async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: "totally not json\n", stderr: "" });
    const res = await runAsrCaptions("/abs/audio.mp3");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(500);
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
