#!/usr/bin/env node
import { ensureSpawnPath } from "./server/spawn-path.js";
import { runCLI } from "./cli.js";

// Repair PATH for non-login-shell launches (Electron .app / launchd / agent
// harness running `node dist/index.js start`) BEFORE anything spawns
// ffmpeg/ffprobe/edge-tts by bare name. See src/server/spawn-path.ts.
ensureSpawnPath();
runCLI();
