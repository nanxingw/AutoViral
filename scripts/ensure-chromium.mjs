#!/usr/bin/env node
// Build-time native-toolchain staging for the packaged desktop app.
//
// Stages three things into desktop/build-resources/ so electron-builder's
// extraResources can copy them verbatim into <resources>/:
//   1. chromium/  — a Chrome Headless Shell (downloaded by Remotion's
//      ensureBrowser if absent). The packaged daemon sets AUTOVIRAL_CHROMIUM_PATH
//      to it so @remotion/renderer NEVER tries to download into a read-only asar.
//   2. ffmpeg/ffmpeg  — from ffmpeg-static (host-arch binary).
//   3. ffmpeg/ffprobe — from the @ffprobe-installer platform subpackage.
//
// Remotion downloads the headless shell to
//   node_modules/.remotion/chrome-headless-shell/<platform>/
// (platform: mac-arm64 | mac-x64 | linux64 | linux-arm64 | win64). We walk that
// dir for the executable and copy the whole shell subtree (it has sibling .so /
// resource files the binary needs) into desktop/build-resources/chromium/.
//
// Usage: node scripts/ensure-chromium.mjs
//
// NB cross-arch: ffmpeg-static + the resolved ffprobe binary are HOST-arch. A
// universal/cross-arch dmg therefore needs a per-arch build host (or CI matrix).
// For 0.1.0 we build per-arch; this script always stages the host arch.

import { ensureBrowser } from "@remotion/renderer";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const require = createRequire(import.meta.url);

const BUILD_RES = join(REPO_ROOT, "desktop", "build-resources");
const CHROMIUM_OUT = join(BUILD_RES, "chromium");
const FFMPEG_OUT_DIR = join(BUILD_RES, "ffmpeg");

const HEADLESS_NAMES = [
  "chrome-headless-shell",
  "chrome-headless-shell.exe",
  "headless_shell",
  "headless_shell.exe",
  "chrome",
  "chrome.exe",
];

/** Depth-first walk for the first file whose basename is in `names`. */
function findExecutable(root, names) {
  if (!existsSync(root)) return "";
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (names.includes(name)) return full;
    }
  }
  return "";
}

async function stageChromium() {
  // Download the headless shell if missing (no-op if already present).
  console.log("[ensure-chromium] ensuring Chrome Headless Shell…");
  await ensureBrowser({
    onBrowserDownload: () => {
      console.log("[ensure-chromium] downloading Chrome Headless Shell…");
      return {
        onProgress: ({ percent }) => {
          process.stdout.write(`\r[ensure-chromium] ${Math.round(percent * 100)}%   `);
        },
      };
    },
  });
  process.stdout.write("\n");

  const remotionCache = join(REPO_ROOT, "node_modules", ".remotion", "chrome-headless-shell");
  const exec = findExecutable(remotionCache, HEADLESS_NAMES);
  if (!exec) {
    throw new Error(
      `Could not find a Chrome Headless Shell executable under ${remotionCache} after ensureBrowser().`,
    );
  }

  // The executable's grandparent is the platform dir (…/<platform>/chrome-headless-shell-*/exe).
  // Copy the whole platform subtree so sibling resources travel with the binary.
  // platformDir = …/chrome-headless-shell/<platform>
  const shellRevisionDir = dirname(exec); // …/<platform>/chrome-headless-shell-<ver>-<plat>
  const platformDir = dirname(shellRevisionDir); // …/chrome-headless-shell/<platform>

  rmSync(CHROMIUM_OUT, { recursive: true, force: true });
  mkdirSync(CHROMIUM_OUT, { recursive: true });
  // Copy the platform dir's contents into chromium/ → chromium/chrome-headless-shell-*/exe
  cpSync(platformDir, CHROMIUM_OUT, { recursive: true });

  const stagedExec = findExecutable(CHROMIUM_OUT, HEADLESS_NAMES);
  if (stagedExec) {
    try {
      chmodSync(stagedExec, 0o755);
    } catch {
      /* best effort */
    }
  }
  console.log(`[ensure-chromium] staged chromium → ${CHROMIUM_OUT}`);
  console.log(`[ensure-chromium] headless shell exec → ${stagedExec}`);
}

function stageFfmpeg() {
  mkdirSync(FFMPEG_OUT_DIR, { recursive: true });

  // ffmpeg-static default-exports the absolute path to the ffmpeg binary.
  const ffmpegSrc = require("ffmpeg-static");
  if (!ffmpegSrc || !existsSync(ffmpegSrc)) {
    throw new Error(`ffmpeg-static binary not found (got: ${ffmpegSrc}).`);
  }
  const ffmpegOut = join(FFMPEG_OUT_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  cpSync(ffmpegSrc, ffmpegOut);
  try {
    chmodSync(ffmpegOut, 0o755);
  } catch {
    /* best effort */
  }
  console.log(`[ensure-chromium] staged ffmpeg → ${ffmpegOut}`);

  // @ffprobe-installer/ffprobe exposes { path } pointing at the platform binary.
  const ffprobe = require("@ffprobe-installer/ffprobe");
  const ffprobeSrc = ffprobe?.path;
  if (!ffprobeSrc || !existsSync(ffprobeSrc)) {
    throw new Error(`@ffprobe-installer ffprobe binary not found (got: ${ffprobeSrc}).`);
  }
  const ffprobeOut = join(FFMPEG_OUT_DIR, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  cpSync(ffprobeSrc, ffprobeOut);
  try {
    chmodSync(ffprobeOut, 0o755);
  } catch {
    /* best effort */
  }
  console.log(`[ensure-chromium] staged ffprobe → ${ffprobeOut}`);
}

async function main() {
  mkdirSync(BUILD_RES, { recursive: true });
  await stageChromium();
  stageFfmpeg();
  console.log("[ensure-chromium] done.");
}

main().catch((err) => {
  console.error("[ensure-chromium] failed:", err);
  process.exit(1);
});
