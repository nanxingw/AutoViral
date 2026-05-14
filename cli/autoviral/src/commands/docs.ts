// `autoviral docs [topic]` — print the operator manual.
//
// The /docs endpoint returns raw markdown, NOT the standard {ok,result}
// JSON envelope. That's deliberate — agents pipe the output into their
// reading context and don't need to parse JSON. So this command bypasses
// bridgeRequest and uses undici fetch directly.

import { fetch as undiciFetch } from "undici";
import { readContext } from "../client.js";

export async function docsCommand(args: string[]): Promise<void> {
  const ctx = readContext();
  const topic = args[0];
  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : "";
  const res = await undiciFetch(
    `http://127.0.0.1:${ctx.port}/api/bridge/v1/docs${qs}`,
    { headers: { "X-AutoViral-Work-Id": ctx.workId } },
  );
  if (!res.ok) {
    process.stderr.write(`autoviral docs: ${res.status}\n`);
    process.exit(3);
  }
  process.stdout.write(await res.text());
}
