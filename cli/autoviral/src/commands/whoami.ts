// `autoviral whoami` — prints the active Studio context.
//
// Mostly useful as a smoke test that the env wiring + bridge HTTP round-trip
// works from within a terminal panel.

import { bridgeRequest, readContext } from "../client.js";
import { writeOut } from "../output.js";

export async function whoamiCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  const result = await bridgeRequest<{
    workId: string;
    cwd: string;
    port: number;
    version: string;
  }>(ctx, "GET", "/whoami");
  writeOut(result);
}
