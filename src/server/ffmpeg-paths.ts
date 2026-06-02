// Resolved ffmpeg / ffprobe binary names.
//
// The daemon spawns ffmpeg/ffprobe by these values. In dev they default to
// the bare names (PATH-resolved). In a PACKAGED app the launcher sets
// FFMPEG_PATH / FFPROBE_PATH to the bundled binaries, so the daemon points
// at them instead of relying on a system install.
//
// NB: ffmpeg-static ships ffmpeg ONLY (no ffprobe), so the two are resolved
// independently — a packaged app must provide both env vars.

export const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_PATH ?? "ffprobe";
