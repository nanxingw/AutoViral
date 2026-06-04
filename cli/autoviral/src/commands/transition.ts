// `autoviral transition add|remove` — cut-point transition write surface.
//
// S9 (US 4/5/9). Both sub-verbs round-trip through the bridge so the canonical
// disk state is always the server's. The bridge runs the shared
// `ops.addTransition` / `ops.removeTransition` (the SAME code the Studio
// transition picker uses), so an agent adding a transition via the CLI and a
// human picking one in the UI converge on the same composition. We validate the
// args locally (exit 4, never hits the bridge) so an obviously-malformed
// invocation fails fast; the server's video-only guard, last-clip-anchor
// rejection and shared-registry preset check own the semantic validation.

import { bridgeRequest, readContext } from "../client.js";

export async function transitionCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "add") {
    const opts = parseFlags(rest);
    const track = opts["--track"];
    const after = opts["--after"];
    const preset = opts["--preset"];
    if (!track) {
      process.stderr.write(
        "autoviral transition add: --track <trackId> required\n",
      );
      process.exit(4);
    }
    if (!after) {
      process.stderr.write(
        "autoviral transition add: --after <clipId> required\n",
      );
      process.exit(4);
    }
    if (!preset) {
      process.stderr.write(
        "autoviral transition add: --preset <name> required\n",
      );
      process.exit(4);
    }
    const body: Record<string, unknown> = {
      trackId: track,
      afterClipId: after,
      preset,
    };
    if (opts["--duration"] !== undefined) {
      const dur = Number(opts["--duration"]);
      if (!Number.isFinite(dur)) {
        process.stderr.write(
          "autoviral transition add: --duration <seconds> must be a number\n",
        );
        process.exit(4);
      }
      body.durationSec = dur;
    }
    const result = await bridgeRequest<{ id: string }>(
      ctx,
      "POST",
      "/transition",
      body,
    );
    process.stdout.write(`${result.id}\n`);
    return;
  }

  if (sub === "remove") {
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral transition remove <id>\n");
      process.exit(4);
    }
    await bridgeRequest(
      ctx,
      "DELETE",
      `/transition/${encodeURIComponent(id)}`,
      undefined,
    );
    return;
  }

  process.stderr.write(`autoviral transition: unknown subcommand "${sub ?? ""}"\n`);
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
