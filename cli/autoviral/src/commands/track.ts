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

  if (sub === "collapse") {
    // S7 (PRD-0014) — `autoviral track collapse <trackId>` repacks the lane's
    // clips back-to-back from 0 through the shared `ops.collapseGapsOnTrack` (the
    // SAME code the Studio collapse-gaps toolbar runs). Unknown track → bridge
    // 400/code:4 → exit 4.
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral track collapse <trackId>\n");
      process.exit(4);
    }
    await bridgeRequest(
      ctx,
      "POST",
      `/track/${encodeURIComponent(id)}/collapse`,
      {},
    );
    return;
  }

  if (sub === "set") {
    // S7 (PRD-0014) — `autoviral track set <trackId> --label/--language/--volume/
    // --muted/--hidden`. PATCHes only the supplied props through the shared
    // `ops.setTrackProps` (the SAME code the Studio renameTrack / setTrackLanguage
    // / setTrackVolume actions run) — spread-guard means siblings are untouched.
    // `--language ""` clears the field. We validate args locally (exit 4); the
    // server owns the unknown-track + type validation.
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write(
        "usage: autoviral track set <trackId> [--label <s>] [--language <s|\"\">] [--volume <dB>] [--muted <true|false>] [--hidden <true|false>]\n",
      );
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const props: Record<string, unknown> = {};
    if (opts["--label"] !== undefined) props.label = opts["--label"];
    if (opts["--language"] !== undefined) {
      // Empty string clears the language (→ null); anything else sets it.
      props.language = opts["--language"] === "" ? null : opts["--language"];
    }
    if (opts["--volume"] !== undefined) {
      const v = Number(opts["--volume"]);
      if (!Number.isFinite(v)) {
        process.stderr.write(
          "autoviral track set: --volume <dB> must be a number\n",
        );
        process.exit(4);
      }
      props.volume = v;
    }
    // Strict boolean parse (S7 review fix): only the literal `true`/`false` are
    // accepted. The old `=== "true"` silently coerced ANY typo (`--muted treu`)
    // to `false`, which would UNmute a track instead of erroring — a silent
    // data-corruption footgun.
    if (opts["--muted"] !== undefined) {
      props.muted = parseStrictBool("--muted", opts["--muted"]);
    }
    if (opts["--hidden"] !== undefined) {
      props.hidden = parseStrictBool("--hidden", opts["--hidden"]);
    }
    if (Object.keys(props).length === 0) {
      process.stderr.write(
        "autoviral track set: at least one of --label / --language / --volume / --muted / --hidden is required\n",
      );
      process.exit(4);
    }
    await bridgeRequest(
      ctx,
      "PATCH",
      `/track/${encodeURIComponent(id)}`,
      props,
    );
    return;
  }

  process.stderr.write(`autoviral track: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
}

// Strict boolean flag parse — accepts ONLY the literals `true` / `false`, exits
// 4 (never hits the bridge) on anything else. A missing value or a typo is a
// hard error, not a silent `false` (S7 review fix).
function parseStrictBool(flag: string, raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  process.stderr.write(
    `autoviral track set: ${flag} expects true|false (got "${raw ?? ""}")\n`,
  );
  process.exit(4);
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
