// `autoviral context [--watch] [--inject on|off]`
//
// H0.3 — agent-facing context aggregator.
//
//   autoviral context              one-shot JSON snapshot
//   autoviral context --watch      stream NDJSON; Ctrl+C closes cleanly
//   autoviral context --inject off / on   toggle terminal prefix line

import { bridgeRequest, readContext } from "../client.js";

interface CtxFlags {
  watch: boolean;
  inject?: "on" | "off";
}

function parseFlags(args: string[]): CtxFlags {
  const flags: CtxFlags = { watch: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--watch") flags.watch = true;
    else if (a === "--inject") {
      const v = args[++i];
      if (v !== "on" && v !== "off") {
        process.stderr.write(
          `autoviral: --inject expects "on" or "off" (got ${v ?? "<none>"})\n`,
        );
        process.exit(4);
      }
      flags.inject = v;
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  return flags;
}

export async function contextCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const ctx = readContext();

  if (flags.inject) {
    const enabled = flags.inject === "on";
    const result = await bridgeRequest<{ enabled: boolean }>(
      ctx,
      "POST",
      "/context/inject",
      { enabled },
    );
    process.stdout.write(`inject ${result.enabled ? "on" : "off"}\n`);
    return;
  }

  if (flags.watch) {
    await streamContext(ctx);
    return;
  }

  const snapshot = await bridgeRequest<unknown>(ctx, "GET", "/context", null);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

interface ClientContext {
  workId: string;
  port: number;
}

async function streamContext(ctx: ClientContext): Promise<void> {
  const url = `http://localhost:${ctx.port}/api/bridge/v1/context/stream`;
  const controller = new AbortController();
  // Ctrl+C → graceful close
  const onSignal = () => {
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const res = await fetch(url, {
      headers: { "X-AutoViral-Work-Id": ctx.workId },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      process.stderr.write(
        `autoviral: context stream returned ${res.status} ${res.statusText}\n`,
      );
      process.exit(3);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines; each frame is
      // `data: <json>` (possibly preceded by `:heartbeat` comments).
      let split: number;
      while ((split = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, split);
        buf = buf.slice(split + 2);
        const dataLine = frame
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        process.stdout.write(`${dataLine.slice(6)}\n`);
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return;
    throw err;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
