#!/usr/bin/env node
// Entry. Phase 2: read-only command surface (whoami / docs / comp / list).
// The dispatcher pattern + exit-code conventions are intentionally kept
// thin so Phase 3 just plugs more handlers in.

import { whoamiCommand } from "./commands/whoami.js";
import { compCommand } from "./commands/comp.js";

const [, , subcommand, ...rest] = process.argv;
const dispatch: Record<string, (args: string[]) => Promise<void>> = {
  whoami: whoamiCommand,
  comp: compCommand,
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
    "Commands:",
    "  whoami              Print current Studio context (workId, cwd, port)",
    "  docs [topic]        Print operator manual",
    "  comp show           Print composition.yaml",
    "  list clips [...]    List video clips",
    "  list assets [...]   List assets",
    "",
    "Run `autoviral docs` for the full manual.",
    "",
  ].join("\n");
}
