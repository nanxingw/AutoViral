// `autoviral comp [show|diff]` — read-only composition introspection.
//
// `show` returns the full composition.yaml as structured data; pipe to jq
// in agent contexts, scan as YAML in interactive ones.
//
// `diff` is stubbed until Phase 3 because the on-disk write surface
// doesn't exist yet — there's nothing to diff against. Failing here with
// exit 4 (validation) keeps the contract honest.

import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function compCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "show" || sub === undefined) {
    const ctx = readContext();
    const result = await bridgeRequest<unknown>(ctx, "GET", "/comp");
    writeOut(result);
    return;
  }
  if (sub === "diff") {
    process.stderr.write("autoviral comp diff: not yet implemented (Phase 3)\n");
    process.exit(4);
  }
  process.stderr.write(`autoviral comp: unknown subcommand "${sub}"\n`);
  process.exit(127);
}
