// `autoviral clip add|set|remove|split` — composition.yaml write surface.
//
// All three sub-verbs round-trip through the bridge so the canonical
// disk state is always the server's (no local edit-then-push). The
// server validates via zod before atomic-renaming the file — invalid
// patches leave the on-disk composition untouched.

import { bridgeRequest, readContext } from "../client.js";

export async function clipCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "add") {
    const opts = parseFlags(rest);
    const track = opts["--track"] ?? "video";
    if (track === "text") {
      if (!opts["--text"]) {
        process.stderr.write("autoviral clip add --track text: --text required\n");
        process.exit(4);
      }
    } else {
      if (!opts["--src"]) {
        process.stderr.write("autoviral clip add: --src required\n");
        process.exit(4);
      }
    }
    const body: Record<string, unknown> = {
      src: opts["--src"],
      text: opts["--text"],
      track,
      offset: opts["--offset"] ? Number(opts["--offset"]) : 0,
      duration: opts["--duration"] ? Number(opts["--duration"]) : undefined,
      in: opts["--in"] ? Number(opts["--in"]) : undefined,
      out: opts["--out"] ? Number(opts["--out"]) : undefined,
    };
    const result = await bridgeRequest<{ id: string }>(ctx, "POST", "/clip", body);
    process.stdout.write(`${result.id}\n`);
    return;
  }

  if (sub === "remove") {
    const id = rest[0];
    if (!id) {
      process.stderr.write("usage: autoviral clip remove <id>\n");
      process.exit(4);
    }
    await bridgeRequest(ctx, "DELETE", `/clip/${encodeURIComponent(id)}`, undefined);
    return;
  }

  if (sub === "split") {
    // S6 (US 1/9) — `autoviral clip split <id> --at <sec>`. The bridge runs the
    // shared `ops.splitClip` (same code the Studio UI uses), so the two paths
    // produce an identical composition. We validate the args locally (exit 4,
    // never hits the bridge) so an obviously-malformed invocation fails fast.
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral clip split <id> --at <seconds>\n");
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const atRaw = opts["--at"];
    const at = atRaw === undefined ? NaN : Number(atRaw);
    if (!Number.isFinite(at)) {
      process.stderr.write("autoviral clip split: --at <seconds> required\n");
      process.exit(4);
    }
    const result = await bridgeRequest<{ id: string }>(ctx, "POST", "/split", {
      clipId: id,
      at,
    });
    process.stdout.write(`${result.id}\n`);
    return;
  }

  if (sub === "set") {
    const id = rest[0];
    if (!id) {
      process.stderr.write("usage: autoviral clip set <id> [--key value]...\n");
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
      const key = k.replace(/^--/, "");
      patch[key] = /^-?[\d.]+$/.test(v) ? Number(v) : v;
    }
    await bridgeRequest(ctx, "PATCH", `/clip/${encodeURIComponent(id)}`, patch);
    return;
  }

  process.stderr.write(`autoviral clip: unknown subcommand "${sub ?? ""}"\n`);
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
