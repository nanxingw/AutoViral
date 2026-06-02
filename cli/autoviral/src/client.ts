// HTTP client + context resolver for the AutoViral CLI.
//
// Every command resolves `BridgeContext` from env first (set by the Studio
// terminal panel adapter — see specs/2026-05-14-agentic-terminal-bridge-
// protocol.md §Environment contract). Missing AUTOVIRAL_WORK_ID is fatal
// with exit 2 so this binary is safe to leave on the user's global PATH:
// running it outside the Studio fails fast with a clear message.

// HTTP via Node 20+ global fetch (dropped undici — keeps this CLI a clean,
// dependency-free ESM bundle; engines.node is >=20 so global fetch is guaranteed).

export interface BridgeContext {
  workId: string;
  port: number;
  cwd: string;
}

export function readContext(): BridgeContext {
  const workId = process.env.AUTOVIRAL_WORK_ID;
  const port = Number(process.env.AUTOVIRAL_PORT ?? 3271);
  const cwd = process.env.AUTOVIRAL_CWD ?? process.cwd();
  if (!workId) {
    process.stderr.write(
      "autoviral: AUTOVIRAL_WORK_ID env not set — are you running outside the Studio terminal?\n",
    );
    process.exit(2);
  }
  return { workId, port, cwd };
}

export async function bridgeRequest<T>(
  ctx: BridgeContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `http://127.0.0.1:${ctx.port}/api/bridge/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-AutoViral-Work-Id": ctx.workId,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: bridge ${method} ${path} → ${res.status} ${txt}\n`);
    process.exit(3);
  }
  const json = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!json.ok) {
    process.stderr.write(`autoviral: ${json.error ?? "unknown error"}\n`);
    process.exit(3);
  }
  return json.result as T;
}
