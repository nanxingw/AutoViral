// `autoviral play` / `pause` — fire-and-forget UI commands.

import { bridgeRequest, readContext } from "../client.js";

export async function playCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/play", {});
}

export async function pauseCommand(_args: string[]): Promise<void> {
  const ctx = readContext();
  await bridgeRequest(ctx, "POST", "/pause", {});
}
