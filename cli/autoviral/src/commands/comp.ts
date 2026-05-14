// `autoviral comp [show|diff]` — read-only composition introspection.
//
// `show` returns the full composition.yaml as structured data; pipe to jq
// in agent contexts, scan as YAML in interactive ones.
//
// `diff` (Phase 5 Task 5.4) prints the unified diff between
// composition.yaml.previous (snapshot taken just before the most recent
// write) and the current composition.yaml. Exits 0 with `(no changes
// since last write)` if the two are identical; 0 with a friendly note
// if no baseline snapshot exists yet (first write of this workspace).

import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

interface CompDiffResult {
  diff: string;
  hasBaseline: boolean;
}

export async function compCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "show" || sub === undefined) {
    const ctx = readContext();
    const result = await bridgeRequest<unknown>(ctx, "GET", "/comp");
    writeOut(result);
    return;
  }
  if (sub === "diff") {
    const ctx = readContext();
    const result = await bridgeRequest<CompDiffResult>(ctx, "GET", "/comp/diff");
    if (!result.hasBaseline) {
      process.stdout.write(
        "(no prior write to diff against — composition.yaml.previous has not been written yet)\n",
      );
      return;
    }
    if (result.diff === "") {
      process.stdout.write("(no changes since last write)\n");
      return;
    }
    process.stdout.write(result.diff);
    return;
  }
  process.stderr.write(`autoviral comp: unknown subcommand "${sub}"\n`);
  process.exit(127);
}
