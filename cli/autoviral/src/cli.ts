#!/usr/bin/env node
// Entry. Phase 2: read-only command surface (whoami / docs / comp / list).
// Phase 3: write + UI control (select / seek / play / pause / toast /
// progress / clip / ask / export / render). The dispatcher pattern + exit-
// code conventions are intentionally kept thin so future phases just plug
// more handlers in.

import { whoamiCommand } from "./commands/whoami.js";
import { compCommand } from "./commands/comp.js";
import { listCommand } from "./commands/list.js";
import { docsCommand } from "./commands/docs.js";
import { selectCommand } from "./commands/select.js";
import { seekCommand } from "./commands/seek.js";
import { playCommand, pauseCommand } from "./commands/play.js";
import { toastCommand } from "./commands/toast.js";
import { progressCommand } from "./commands/progress.js";
import { clipCommand } from "./commands/clip.js";
import { carouselCommand } from "./commands/carousel.js";
import { askCommand } from "./commands/ask.js";
import { exportCommand, renderCommand } from "./commands/export.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { ingestCommand } from "./commands/ingest.js";
import { preprocessCommand } from "./commands/preprocess.js";
import { contextCommand } from "./commands/context.js";
import { trendsCommand, profileCommand } from "./commands/trends.js";
import { doctorCommand } from "./commands/doctor.js";
import { setupCommand } from "./commands/setup.js";
import {
  lintCommand,
  inspectCommand,
  validateCommand,
  animationMapCommand,
  checkCommand,
} from "./commands/check.js";

const [, , subcommand, ...rest] = process.argv;
const dispatch: Record<string, (args: string[]) => Promise<void>> = {
  whoami: whoamiCommand,
  comp: compCommand,
  list: listCommand,
  docs: docsCommand,
  select: selectCommand,
  seek: seekCommand,
  play: playCommand,
  pause: pauseCommand,
  toast: toastCommand,
  progress: progressCommand,
  clip: clipCommand,
  carousel: carouselCommand,
  ask: askCommand,
  export: exportCommand,
  render: renderCommand,
  snapshot: snapshotCommand,
  ingest: ingestCommand,
  preprocess: preprocessCommand,
  context: contextCommand,
  trends: trendsCommand,
  profile: profileCommand,
  doctor: doctorCommand,
  setup: setupCommand,
  lint: lintCommand,
  inspect: inspectCommand,
  validate: validateCommand,
  "animation-map": animationMapCommand,
  check: checkCommand,
};

(async () => {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  const handler = dispatch[subcommand];
  if (!handler) {
    process.stderr.write(`autoviral: unknown command "${subcommand}"\n`);
    process.exit(127);
  }
  await handler(rest);
})().catch((e) => {
  process.stderr.write(`autoviral: ${e.message ?? String(e)}\n`);
  process.exit(3);
});

function usage(): string {
  return [
    "autoviral — bridge between shell agents and the AutoViral Studio.",
    "",
    "Read commands:",
    "  whoami                       Print current Studio context (workId, cwd, port)",
    "  docs [topic]                 Print operator manual",
    "  comp show                    Print composition.yaml",
    "  list clips [--track K]       List clips, optionally filtered by track",
    "  list assets [--kind K]       List assets",
    "",
    "UI commands:",
    "  select <clip|track|none> <id>",
    "  seek <seconds|'12.5s'|'1m30s'>",
    "  play | pause",
    "  toast <message> [--kind info|success|warn|error] [--duration ms]",
    "  progress start <label> [--steps N] | step <n> | done",
    "",
    "Write + tasks:",
    "  clip add --src <path> [--track video|audio|text|overlay] [--offset s] [--duration s]",
    "  clip set <id> [--key value]...",
    "  clip remove <id>",
    "  carousel add-slide [--at N] [--bg-type gradient|image|solid --bg-value V]",
    "  carousel set-layer <slideId> --kind <text|image|shape|sticker> [--id L] [--x N --y N --w N --h N] [...]",
    "    Carousel (图文) write surface. Full schema: `autoviral docs carousel/02-schema`.",
    "  ask <message> [--yes-no|--ok-cancel] [--timeout seconds]",
    "  export [--preset name] [--proxy]",
    "  render                        Alias for `export --proxy`",
    "  snapshot [--at <time>] [--slide <id>]",
    "    Capture the CURRENT frame (video) or slide (carousel) as a PNG and",
    "    print its path — Read it to visually self-check before delivering.",
    "",
    "Ingest:",
    "  ingest youtube <url> [--lang zh-CN] [--model <openrouter-id>]",
    "    Download YouTube → transcribe (Whisper) → translate via OpenRouter",
    "    → bootstrap composition.yaml with overlay captions.",
    "",
    "Setup / diagnostics:",
    "  doctor                        Print a dependency readiness table",
    "    (ffmpeg/ffprobe, TTS venv, playwright, claude CLI). Non-zero exit if a",
    "    CORE dep (ffmpeg/ffprobe) is missing. Runs locally — no daemon needed.",
    "  setup [--heavy]               Install missing deps with progress",
    "    (managed ffmpeg/ffprobe + TTS venv). --heavy also installs playwright",
    "    chromium now (else it lazy-installs on first use). No npm postinstall.",
    "",
    "Run `autoviral docs` for the full manual.",
    "",
  ].join("\n");
}
