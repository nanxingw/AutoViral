#!/usr/bin/env node
// Entry. Phase 0 stub — real commands land in Phase 2.
// The dispatcher pattern + exit-code conventions are intentionally
// established here so Phase 2 just plugs handlers in.

const EXIT = {
  OK: 0,
  USER_NO: 1,
  WRONG_STATE: 2,
  PROTOCOL: 3,
  VALIDATION: 4,
  TIMEOUT: 124,
  UNKNOWN_CMD: 127,
} as const;

function usage(): string {
  return [
    "autoviral — bridge between shell agents and the AutoViral Studio.",
    "",
    "Phase 0 stub: command surface lands in Phase 2.",
    "See docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md",
    "",
  ].join("\n");
}

const [, , subcommand, ..._rest] = process.argv;

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  process.stdout.write(usage());
  process.exit(EXIT.OK);
}

process.stderr.write(`autoviral: unknown command "${subcommand}" (Phase 0 stub)\n`);
process.exit(EXIT.UNKNOWN_CMD);
