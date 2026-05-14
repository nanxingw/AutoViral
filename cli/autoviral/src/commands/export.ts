// `autoviral export [--preset name] [--proxy]` — kick off the render
// pipeline server-side and print the final output path on success.
//
// `autoviral render` is an alias that forces `--proxy` for fast review
// renders.

import { bridgeRequest, readContext } from "../client.js";

export async function exportCommand(args: string[]): Promise<void> {
  const presetIdx = args.indexOf("--preset");
  const preset = presetIdx >= 0 ? args[presetIdx + 1] : undefined;
  const proxy = args.includes("--proxy");
  const ctx = readContext();
  const result = await bridgeRequest<{ path: string }>(ctx, "POST", "/export", {
    preset,
    proxy,
  });
  process.stdout.write(`${result.path}\n`);
}

export async function renderCommand(args: string[]): Promise<void> {
  return exportCommand([...args, "--proxy"]);
}
