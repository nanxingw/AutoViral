// `autoviral progress start <label> [--steps N]` / `step <n>` / `done`
// Coarse-grained progress signals for long-running agent operations.

import { bridgeRequest, readContext } from "../client.js";

export async function progressCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();
  if (sub === "start") {
    const label = rest[0] ?? "";
    if (!label) {
      process.stderr.write("usage: autoviral progress start <label> [--steps N]\n");
      process.exit(4);
    }
    const stepsIdx = rest.indexOf("--steps");
    const steps = stepsIdx >= 0 ? Number(rest[stepsIdx + 1]) : undefined;
    await bridgeRequest(ctx, "POST", "/progress", { phase: "start", label, steps });
    return;
  }
  if (sub === "step") {
    const n = Number(rest[0] ?? "0");
    await bridgeRequest(ctx, "POST", "/progress", { phase: "step", n });
    return;
  }
  if (sub === "done") {
    await bridgeRequest(ctx, "POST", "/progress", { phase: "done" });
    return;
  }
  process.stderr.write("usage: autoviral progress start|step|done\n");
  process.exit(4);
}
