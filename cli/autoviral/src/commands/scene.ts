// `autoviral scene add|list|set|reorder|link|remove` — the storyboard
// (分镜) write/read surface over the planning layer.
//
// S2 (PRD-0007). A scene is one shot in the storyboard table: title + intent
// (hook/build/payoff/cta) + prompt/narration + 景别(shotSize) / 运镜
// (cameraMovement) + duration, plus the generation-handoff state
// (generatedAssetIds / selectedAssetId / status). All five write verbs
// round-trip through the bridge so the canonical disk state is always the
// server's — the bridge runs the SAME shared `ops.addScene` / `setSceneProps`
// / `reorderScenes` / `linkSceneAssets` / `removeScene` the (future) Studio
// storyboard panel uses, so an agent排ing scenes via the CLI and a human
// editing cards in the UI converge on the same `composition.yaml scenes[]`.
// `scene add` echoes the minted sceneId so the agent can immediately
// `scene link <id> --asset ...`. `scene list` is a READ off `comp show`
// (GET /comp → result.scenes), so it has no write route.
//
// We validate enum-typed flags locally (exit 4, never hits the bridge) so an
// obviously-malformed invocation fails fast; the server owns id/permutation/
// asset validation (unknown id, incomplete permutation → its own 400 code:4).

import { bridgeRequest, readContext } from "../client.js";

const INTENTS = ["hook", "build", "payoff", "cta"];
const SHOT_SIZES = ["long", "full", "medium", "close", "closeup"];
const CAMERA_MOVEMENTS = ["push", "pull", "pan", "track", "follow", "static"];
const LINK_STATUSES = ["planned", "generated", "stale"];

interface SceneRow {
  id: string;
  order: number;
  title: string;
  intent?: string;
  status?: string;
}

export async function sceneCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "add") {
    // POST /scene — body passed straight to the shared `ops.addScene`. `--title`
    // is the one required field (mirrors the route's shape gate). The enum flags
    // are validated locally so a typo fails fast without a round-trip; the rest
    // are forwarded verbatim.
    const opts = parseFlags(rest);
    const title = opts["--title"];
    if (!title) {
      process.stderr.write(
        "autoviral scene add: --title <text> required\n",
      );
      process.exit(4);
    }
    const intent = readEnumFlag(opts, "--intent", INTENTS, "scene add");
    const shotSize = readEnumFlag(opts, "--shot-size", SHOT_SIZES, "scene add");
    const cameraMovement = readEnumFlag(
      opts,
      "--camera",
      CAMERA_MOVEMENTS,
      "scene add",
    );
    const body: Record<string, unknown> = { title };
    if (intent) body.intent = intent;
    if (opts["--prompt"]) body.prompt = opts["--prompt"];
    if (opts["--narration"]) body.narration = opts["--narration"];
    if (opts["--duration"] !== undefined) {
      const v = Number(opts["--duration"]);
      if (!Number.isFinite(v)) {
        process.stderr.write(
          "autoviral scene add: --duration <seconds> must be a number\n",
        );
        process.exit(4);
      }
      body.durationSec = v;
    }
    if (shotSize) body.shotSize = shotSize;
    if (cameraMovement) body.cameraMovement = cameraMovement;
    if (opts["--md-anchor"]) body.mdAnchor = opts["--md-anchor"];
    const result = await bridgeRequest<{ sceneId: string }>(
      ctx,
      "POST",
      "/scene",
      body,
    );
    process.stdout.write(`${result.sceneId}\n`);
    return;
  }

  if (sub === "list") {
    // READ — `scene list` is a projection off GET /comp (result.scenes), the
    // same way the route tests read scenes back. No write route is involved.
    // Print one line per scene, sorted by `order`: order / id / title / intent /
    // status. Plain text (not JSON) so a human scanning the storyboard reads it
    // top-to-bottom; agents that want structured data use `autoviral comp show`.
    const comp = await bridgeRequest<{ scenes?: SceneRow[] }>(ctx, "GET", "/comp");
    const scenes = [...(comp.scenes ?? [])].sort((a, b) => a.order - b.order);
    for (const s of scenes) {
      const intent = s.intent ?? "-";
      const status = s.status ?? "planned";
      process.stdout.write(
        `${s.order}\t${s.id}\t${s.title}\t${intent}\t${status}\n`,
      );
    }
    return;
  }

  if (sub === "set") {
    // PATCH /scene/:id — the body IS the props object directly (mirrors PATCH
    // /clip/:id). We send ONLY the flags the caller supplied so a partial edit
    // patches just those fields; enum flags are validated locally first.
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral scene set <id> [--key value]...\n");
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const intent = readEnumFlag(opts, "--intent", INTENTS, "scene set");
    const shotSize = readEnumFlag(opts, "--shot-size", SHOT_SIZES, "scene set");
    const cameraMovement = readEnumFlag(
      opts,
      "--camera",
      CAMERA_MOVEMENTS,
      "scene set",
    );
    const props: Record<string, unknown> = {};
    if (opts["--title"] !== undefined) props.title = opts["--title"];
    if (intent) props.intent = intent;
    if (opts["--prompt"] !== undefined) props.prompt = opts["--prompt"];
    if (opts["--narration"] !== undefined) props.narration = opts["--narration"];
    if (opts["--duration"] !== undefined) {
      const v = Number(opts["--duration"]);
      if (!Number.isFinite(v)) {
        process.stderr.write(
          "autoviral scene set: --duration <seconds> must be a number\n",
        );
        process.exit(4);
      }
      props.durationSec = v;
    }
    if (shotSize) props.shotSize = shotSize;
    if (cameraMovement) props.cameraMovement = cameraMovement;
    if (opts["--md-anchor"] !== undefined) props.mdAnchor = opts["--md-anchor"];
    await bridgeRequest(ctx, "PATCH", `/scene/${encodeURIComponent(id)}`, props);
    return;
  }

  if (sub === "reorder") {
    // POST /scene/reorder — { orderedSceneIds }. The args ARE the ids in their
    // new order (`scene reorder <id1> <id2> ...`); at least one is required. The
    // server validates the permutation (must cover every existing scene exactly
    // once) and 400s code:4 on an incomplete one.
    const orderedSceneIds = rest.filter((a) => !a.startsWith("--"));
    if (orderedSceneIds.length === 0) {
      process.stderr.write(
        "usage: autoviral scene reorder <sceneId> [<sceneId>...]\n",
      );
      process.exit(4);
    }
    await bridgeRequest(ctx, "POST", "/scene/reorder", { orderedSceneIds });
    return;
  }

  if (sub === "link") {
    // POST /scene/:id/link — { assetIds, selectedAssetId?, status? }. Links one
    // or more generated assets to a scene (the generation-handoff state). At
    // least one `--asset` is required; `--select` picks the chosen one (defaults
    // server-side to the last asset); `--status` is an enum (validated locally).
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write(
        "usage: autoviral scene link <id> --asset <assetId> [--asset <id2>...] [--select <id>] [--status planned|generated|stale]\n",
      );
      process.exit(4);
    }
    const flagArgs = rest.slice(1);
    const assetIds = collectRepeatedFlag(flagArgs, "--asset");
    if (assetIds.length === 0) {
      process.stderr.write(
        "autoviral scene link: at least one --asset <assetId> required\n",
      );
      process.exit(4);
    }
    const opts = parseFlags(flagArgs);
    const status = readEnumFlag(opts, "--status", LINK_STATUSES, "scene link");
    const body: Record<string, unknown> = { assetIds };
    if (opts["--select"]) body.selectedAssetId = opts["--select"];
    if (status) body.status = status;
    await bridgeRequest(ctx, "POST", `/scene/${encodeURIComponent(id)}/link`, body);
    return;
  }

  if (sub === "remove") {
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral scene remove <id>\n");
      process.exit(4);
    }
    await bridgeRequest(
      ctx,
      "DELETE",
      `/scene/${encodeURIComponent(id)}`,
      undefined,
    );
    return;
  }

  process.stderr.write(`autoviral scene: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
}

// Read an optional enum-valued flag. Absent → undefined (the caller omits the
// field). Present but not in `allowed` → exit 4 BEFORE the bridge, so a typo'd
// enum fails fast with a clear message instead of a server-side 400.
function readEnumFlag(
  opts: Record<string, string>,
  flag: string,
  allowed: string[],
  cmd: string,
): string | undefined {
  const v = opts[flag];
  if (v === undefined) return undefined;
  if (!allowed.includes(v)) {
    process.stderr.write(
      `autoviral ${cmd}: ${flag} must be one of <${allowed.join("|")}>\n`,
    );
    process.exit(4);
  }
  return v;
}

// Collect every value of a flag that may repeat (`--asset a --asset b`). Unlike
// parseFlags (which keeps only the LAST occurrence), this returns all of them in
// order so `scene link` can attach several assets at once.
function collectRepeatedFlag(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        out.push(v);
        i++;
      }
    }
  }
  return out;
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k] = argv[i + 1];
      i++;
    }
  }
  return out;
}
