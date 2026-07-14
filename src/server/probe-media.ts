// PRD-0014 S6 — ffprobe wrapper for `clip import`. The shared `ops.importClip`
// is PURE (no I/O); this module supplies the physical probe result it needs.
//
// The load-bearing field is `durationSec`: a clip with no duration destroys the
// timeline (out<=in), so a probe that can't read a positive finite duration is a
// HARD FAILURE here — we reject rather than hand a poison probe to the op. We
// spawn ffprobe (execFile-style, NOT existsSync — S1 review lesson: a file can
// exist yet be unreadable/corrupt, and only a real probe tells duration truth).

import { spawn } from "node:child_process";
import { FFPROBE_BIN } from "./ffmpeg-paths.js";

export interface MediaProbe {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
}

/** Parse an ffprobe `r_frame_rate` ("24/1", "30000/1001") into fps, or undefined. */
function parseFrameRate(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const [numStr, denStr] = raw.split("/");
  const num = Number(numStr);
  const den = denStr === undefined ? 1 : Number(denStr);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

/**
 * ffprobe `srcPath` for the media metadata `importClip` needs. Resolves with
 * `{ durationSec, width?, height?, fps? }`. REJECTS (never resolves a partial)
 * when ffprobe exits non-zero, its output is unparseable, or — the important
 * case — no usable positive-finite duration can be read. The caller (bridge
 * route) maps a rejection to a 4xx + errorCode rather than placing a clip.
 */
export function probeMedia(
  srcPath: string,
  signal?: AbortSignal,
): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("probeMedia: aborted before spawn"));
      return;
    }
    const child = spawn(FFPROBE_BIN, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      // format=duration is the authoritative container duration; stream fields
      // give dims + frame rate. `-show_entries a:b=c` uses the section:key syntax.
      "-show_entries",
      "format=duration:stream=width,height,r_frame_rate,duration",
      "-of",
      "json",
      srcPath,
    ]);
    const chunks: Buffer[] = [];
    let errBuf = "";
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error("probeMedia: aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d: Buffer) => chunks.push(d));
    child.stderr?.on("data", (d: Buffer) => {
      errBuf += d.toString("utf-8");
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(
          new Error(`probeMedia: ffprobe exit ${code} for ${srcPath}: ${errBuf}`),
        );
        return;
      }
      let parsed: {
        format?: { duration?: unknown };
        streams?: Array<{
          width?: unknown;
          height?: unknown;
          r_frame_rate?: unknown;
          duration?: unknown;
        }>;
      };
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch (err) {
        reject(
          new Error(
            `probeMedia: unparseable ffprobe output for ${srcPath}: ${(err as Error).message}`,
          ),
        );
        return;
      }
      // `importClip` places a VIDEO clip, so a usable video stream is mandatory.
      // ffprobe was invoked with `-select_streams v:0`, so `streams` is empty for
      // a pure-audio file even though `format.duration` is present — accepting the
      // container duration alone would wrongly register an audio-only file as a
      // VideoClip (review finding 5). Require the selected video stream to exist.
      const stream = parsed.streams?.[0];
      if (!stream) {
        reject(
          new Error(
            `probeMedia: no video stream in ${srcPath} — cannot import a non-video file as a video clip`,
          ),
        );
        return;
      }
      // Prefer container duration; fall back to the stream's own duration.
      const durationRaw = parsed.format?.duration ?? stream.duration;
      const durationSec = Number(durationRaw);
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        reject(
          new Error(
            `probeMedia: no usable duration for ${srcPath} (got ${String(durationRaw)})`,
          ),
        );
        return;
      }
      const out: MediaProbe = { durationSec };
      const width = Number(stream.width);
      const height = Number(stream.height);
      if (Number.isFinite(width) && width > 0) out.width = width;
      if (Number.isFinite(height) && height > 0) out.height = height;
      const fps = parseFrameRate(stream.r_frame_rate);
      if (fps !== undefined) out.fps = fps;
      resolve(out);
    });
  });
}
