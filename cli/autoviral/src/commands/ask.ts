// `autoviral ask <message> [--yes-no|--ok-cancel] [--timeout seconds]`
//
// Blocks until the Studio user replies (or timeout elapses). Exit code
// is the canonical agent-readable signal:
//   yes        → 0
//   no         → 1
//   cancelled  → 2
//   timeout    → 124
// Also prints the answer to stdout so chained scripts can `case $(...)`.

import { readContext } from "../client.js";

export async function askCommand(args: string[]): Promise<void> {
  const message = args[0];
  if (!message) {
    process.stderr.write(
      "usage: autoviral ask <message> [--yes-no|--ok-cancel] [--timeout seconds]\n",
    );
    process.exit(4);
  }
  const yesno = args.includes("--yes-no");
  const okCancel = args.includes("--ok-cancel");
  const kind = okCancel ? "ok-cancel" : yesno ? "yes-no" : "yes-no";
  const tIdx = args.indexOf("--timeout");
  const timeoutSeconds = tIdx >= 0 ? Number(args[tIdx + 1]) : 1800;
  const timeoutMs = timeoutSeconds * 1000;

  const ctx = readContext();
  const url = `http://127.0.0.1:${ctx.port}/api/bridge/v1/ask`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AutoViral-Work-Id": ctx.workId,
    },
    body: JSON.stringify({ message, kind, timeoutMs }),
  });

  if (res.status === 504) {
    process.stderr.write("autoviral ask: timeout\n");
    process.exit(124);
  }

  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral ask: ${res.status} ${txt}\n`);
    process.exit(3);
  }

  const json = (await res.json()) as {
    ok: boolean;
    result?: { answer: "yes" | "no" | "cancelled" };
    error?: string;
  };

  if (!json.ok || !json.result) {
    process.stderr.write(`autoviral ask: ${json.error ?? "unknown error"}\n`);
    process.exit(3);
  }

  process.stdout.write(`${json.result.answer}\n`);
  process.exit(
    json.result.answer === "yes" ? 0
      : json.result.answer === "no" ? 1
      : 2,
  );
}
