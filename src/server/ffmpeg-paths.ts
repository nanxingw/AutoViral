// Resolved ffmpeg / ffprobe binary paths.
//
// The daemon spawns ffmpeg/ffprobe by these values. They are now resolved
// through the shared dependency-manager (src/infra/deps.ts), which applies a
// deterministic precedence — env override (FFMPEG_PATH/FFPROBE_PATH) → managed
// ~/.autoviral/bin → VENDORED ffmpeg-static / @ffprobe-installer absolute path →
// bare name on PATH. The vendored absolute path is what makes spawns work under
// a stripped PATH with ZERO system install (PRD-0003 §1 tracer); the bare-name
// last resort keeps ensureSpawnPath()'s Homebrew append as a fallback.
//
// These remain string-valued named exports so every existing spawn site keeps
// importing FFMPEG_BIN / FFPROBE_BIN unchanged. Resolution happens once, at this
// module's load, and is memoised by the deps module. Because ES module imports
// are hoisted (index.ts → api.js → routes/render.js → ffmpeg-paths.js all
// evaluate during the import phase), that load — and therefore the memoised
// values below — PRECEDES startServer()'s body, where ensureSpawnPath() and
// ensureManaged() actually run. This ordering is safe:
//   (a) the vendored ffmpeg-static / @ffprobe-installer tier yields a
//       PATH-INDEPENDENT absolute path, so it spawns correctly regardless of
//       process.env.PATH at import time; and
//   (b) the bare-name last-resort string ("ffmpeg"/"ffprobe") is only resolved
//       by the OS at spawn time — which is AFTER ensureSpawnPath() has repaired
//       process.env.PATH — so the Homebrew append still takes effect.
// A managed copy first populated by ensureManaged() on a FRESH boot is only
// picked up on the NEXT boot (the memoised value is already vendored), which is
// harmless: vendored is equally correct (managed exists for doctor detection,
// not for correctness — see resolve() in deps.ts).
//
// NB: ffmpeg-static ships ffmpeg ONLY (no ffprobe), so the two are resolved
// independently; @ffprobe-installer/ffprobe supplies the ffprobe binary.

import { getFfmpegPath, getFfprobePath } from "../infra/deps.js";

export const FFMPEG_BIN = getFfmpegPath();
export const FFPROBE_BIN = getFfprobePath();
