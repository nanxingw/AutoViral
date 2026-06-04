// `autoviral track add|remove` — lane (track) write surface.
//
// S10 (US 6/7/8). Both sub-verbs round-trip through the bridge so the canonical
// disk state is always the server's. The bridge runs the shared `ops.addTrack`
// / `ops.removeTrack` (the SAME code the Studio "+ lane" button / removeTrack
// action use), so an agent adding an A2 lane via the CLI and a human clicking
// "+ lane" converge on the same composition. `track add` echoes the minted
// trackId on stdout so the agent can immediately `clip add --track-id <id>`.
// We validate the args locally (exit 4, never hits the bridge) so an obviously-
// malformed invocation fails fast; the server's kind validation + lane-placement
// math own the semantic side.

import { bridgeRequest, readContext } from "../client.js";

const KINDS = ["video", "audio", "text", "overlay"];

export async function trackCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "add") {
    const opts = parseFlags(rest);
    const kind = opts["--kind"];
    if (!kind || !KINDS.includes(kind)) {
      process.stderr.write(
        `autoviral track add: --kind <${KINDS.join("|")}> required\n`,
      );
      process.exit(4);
    }
    const body: Record<string, unknown> = { kind };
    // `--after <trackId>` inserts the new lane directly below that anchor;
    // omit it to land at the end of the same-kind block (the default).
    if (opts["--after"]) body.afterTrackId = opts["--after"];
    if (opts["--label"]) body.label = opts["--label"];
    if (opts["--language"]) body.language = opts["--language"];
    const result = await bridgeRequest<{ trackId: string }>(
      ctx,
      "POST",
      "/track",
      body,
    );
    process.stdout.write(`${result.trackId}\n`);
    return;
  }

  if (sub === "remove") {
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral track remove <trackId>\n");
      process.exit(4);
    }
    await bridgeRequest(
      ctx,
      "DELETE",
      `/track/${encodeURIComponent(id)}`,
      undefined,
    );
    return;
  }

  process.stderr.write(`autoviral track: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
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
