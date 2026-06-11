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
import { trackCommand } from "./commands/track.js";
import { sceneCommand } from "./commands/scene.js";
import { scriptCommand } from "./commands/script.js";
import { transitionCommand } from "./commands/transition.js";
import { captionsCommand } from "./commands/captions.js";
import { carouselCommand } from "./commands/carousel.js";
import { askCommand } from "./commands/ask.js";
import { exportCommand, renderCommand } from "./commands/export.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { checkpointCommand } from "./commands/checkpoint.js";
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
  track: trackCommand,
  scene: sceneCommand,
  script: scriptCommand,
  transition: transitionCommand,
  captions: captionsCommand,
  carousel: carouselCommand,
  ask: askCommand,
  export: exportCommand,
  render: renderCommand,
  snapshot: snapshotCommand,
  checkpoint: checkpointCommand,
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
    "  docs [topic]                 Print operator manual. Topic namespaces:",
    "    _shared/… · video/… · carousel/… (manual chapters),",
    "    contracts/… (error-codes · event-stream), recipes/… (task recipes).",
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
    "  comp put <file|->            Write a WHOLE composition (from file or stdin).",
    "    The universal write path: parses YAML/JSON, validates server-side, and",
    "    atomically replaces composition.yaml. Use for rich edits no verb covers.",
    "  comp validate <file|-> [--json]  Preflight a candidate composition WITHOUT",
    "    writing it. Prints {ok,errors,warnings}; exit 4 on blocking errors. Run",
    "    this before `comp put` to skip the write→400→guess loop.",
    "  comp aspect <9:16|1:1|16:9|4:5>  Switch the canvas ratio in one shot. Flips",
    "    width/height and rescales existing clip offsets so content stays in frame.",
    "  comp set --duration <seconds|auto>  Set or SHORTEN the overall timeline",
    "    length. The ONLY path to crop a tail — clip edits only ever GROW duration.",
    "    `auto` derives it from the max clip end; an explicit value shorter than",
    "    content warns (tail past it won't render).",
    "  clip add --src <path> [--track video|audio|text|overlay] [--track-id <trackId>] [--offset s] [--duration s]",
    "    --track is the KIND; --track-id targets an EXACT lane (e.g. A2) instead of",
    "    the first same-kind lane. --track overlay adds a picture-in-picture clip.",
    "  clip set <id> [--key value]...",
    "  clip split <id> --at <seconds>",
    "  clip trim <id> [--in <seconds>] [--out <seconds>]",
    "  clip remove <id>",
    "  track add --kind video|audio|text|overlay [--after <trackId>] [--label L] [--language L]",
    "    Add a new lane; prints the minted trackId. Default placement is the end of",
    "    the same-kind block; --after inserts directly below that anchor lane.",
    "  track remove <trackId>          Remove a lane (its clips go with it).",
    "  scene add --title X [--intent hook|build|payoff|cta] [--prompt ...] [--narration ...]",
    "    [--duration N] [--shot-size long|full|medium|close|closeup]",
    "    [--camera push|pull|pan|track|follow|static] [--md-anchor <heading>]",
    "    Add one shot to the storyboard (分镜表). Prints the minted sceneId. Scenes",
    "    are the planning layer (剧本=PRD / 分镜=issue), decoupled from the timeline;",
    "    they have no direct render effect until you hand a scene off to generation.",
    "  scene list                      List the storyboard (order / id / title / intent / status).",
    "  scene set <id> [--title ...] [--intent ...] [--prompt ...] [--narration ...] [--duration N]",
    "    [--shot-size ...] [--camera ...] [--md-anchor ...]   Patch one scene card.",
    "  scene reorder <id1> <id2> ...   Reorder the storyboard (a full permutation of scene ids).",
    "  scene link <id> --asset <assetId> [--asset <id2>...] [--select <id>] [--status planned|generated|stale]",
    "    Attach generated asset(s) to a scene (the plan→execution handoff state).",
    "  scene generate <id> [--provider <name>]   Generate one image from the scene's own",
    "    fields (the plan→execution handoff); registers it + links it + prints the assetId. Re-run to reshoot.",
    "  scene remove <id>               Remove one shot from the storyboard.",
    "  script show                     Print the 剧本 (plan/script.md) — the narrative",
    "    outline / 'PRD' of the plan. Empty if no script written yet (not an error).",
    "  script edit [--file <path>]     Write the 剧本 from a file (or stdin). Persists",
    "    plan/script.md and refreshes the Studio script editor live.",
    "  transition add --track <trackId> --after <clipId> --preset <name> [--duration <seconds>]",
    "    Add a cut-point transition between two adjacent video clips. Presets come",
    "    from the shared registry (cross-dissolve / wipe-* / push-* / …).",
    "  transition remove <id>          Remove a transition (restore a hard cut).",
    "  captions generate [--language L] [--asset <relpath>] [--track-id <trackId>]",
    "    Run ASR on the work's audio (first audio clip by default, or --asset) and",
    "    write each timecoded segment as a text clip. Prints the # of clips written.",
    "  carousel add-slide [--at N] [--bg-type gradient|image|solid --bg-value V]",
    "  carousel set-layer <slideId> --kind <text|image|shape|sticker> [--id L] [--x N --y N --w N --h N] [...]",
    "    Carousel (图文) write surface. Full schema: `autoviral docs carousel/02-schema`.",
    "  ask <message> [--yes-no|--ok-cancel] [--timeout seconds]",
    "  export [--preset name] [--proxy]",
    "  render                        Alias for `export --proxy`",
    "  snapshot [--at <time>] [--slide <id>]",
    "    Capture the CURRENT frame (video) or slide (carousel) as a PNG and",
    "    print its path — Read it to visually self-check before delivering.",
    "  checkpoint create [--label <text>]   Snapshot the live deliverable(s) NOW",
    "    (manual trigger). A pure CLI agent gets NO auto-snapshot — only the",
    "    ws-bridge chat agent does on each turn — so take one before a risky edit.",
    "    Idempotent: an unchanged yaml writes nothing.",
    "  checkpoint list                List rollback history (newest first).",
    "  checkpoint restore <id>        Roll the deliverable back to checkpoint <id>",
    "    (its `file` from `checkpoint list`). The CURRENT state is snapshotted",
    "    FIRST, so a restore never loses your pending edits — it's reversible.",
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
