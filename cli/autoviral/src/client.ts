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
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
  // S3 (US 18/19) — error-code contract. The CLI's exit code is the agent's
  // control-flow signal: 4 = "your input/validation was wrong" (4xx),
  // 3 = "the service broke" (5xx / malformed response). Fixed-timeout endpoints
  // like /ask handle their own 124 directly in commands/ask.ts and never reach
  // bridgeRequest; but any endpoint that DOES come through this path and
  // returns an explicit numeric `code` (including 124) has that code honoured
  // below in preference to the status-class fallback.
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: bridge ${method} ${path} → ${res.status} ${txt}\n`);
    // Prefer the server-declared code; else map status class (4xx→4, 5xx→3).
    // The body may not be JSON (proxy/HTML error page), so parse defensively.
    let code: number | undefined;
    try {
      const parsed = JSON.parse(txt) as { code?: unknown };
      if (typeof parsed.code === "number") code = parsed.code;
    } catch {
      // non-JSON body — fall through to status-class mapping.
    }
    process.exit(code ?? (res.status >= 400 && res.status < 500 ? 4 : 3));
  }
  const json = (await res.json()) as { ok: boolean; result?: T; error?: string; code?: number };
  if (!json.ok) {
    // HTTP 200 with a business-level failure envelope. Honour an explicit
    // code; default to 3 (treated as a service/protocol error).
    process.stderr.write(`autoviral: ${json.error ?? "unknown error"}\n`);
    process.exit(json.code ?? 3);
  }
  return json.result as T;
}

// Plain-text request against a `/api/works/:workId/...` route (NOT the bridge
// `/api/bridge/v1/*` envelope surface). Used by `script show|edit` (S5):
// GET plan/script.md returns raw markdown, PUT takes raw markdown and returns
// `{ok:true}` JSON. We send/return the body as text — no {ok,result} envelope.
//
// Exit-code contract matches bridgeRequest: 4 = your input/validation was wrong
// (4xx), 3 = the service broke (5xx / malformed response). The work-relative
// path is appended after the workId, so the caller passes e.g. "/plan/script.md".
export async function apiText(
  ctx: BridgeContext,
  method: "GET" | "PUT",
  workPath: string,
  body?: string,
): Promise<string> {
  const url = `http://127.0.0.1:${ctx.port}/api/works/${encodeURIComponent(ctx.workId)}${workPath}`;
  const res = await fetch(url, {
    method,
    headers: body == null ? undefined : { "Content-Type": "text/markdown; charset=utf-8" },
    body: body == null ? undefined : body,
  });
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: api ${method} ${workPath} → ${res.status} ${txt}\n`);
    process.exit(res.status >= 400 && res.status < 500 ? 4 : 3);
  }
  return res.text();
}

// JSON request against a `/api/works/:workId/...` route (NOT the bridge
// `/api/bridge/v1/*` envelope). Used by `checkpoint create` (D3): the manual
// snapshot trigger is `POST /api/works/:id/checkpoints` returning a BARE
// `{ written: Checkpoint[] }` JSON object (no `{ok,result}` envelope — those
// works routes predate the bridge surface). Same exit-code contract as
// bridgeRequest: 4 = your input/validation was wrong (4xx), 3 = the service
// broke (5xx / malformed response). The work-relative path is appended after
// the workId, so the caller passes e.g. "/checkpoints".
export async function apiJson<T>(
  ctx: BridgeContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  workPath: string,
  body?: unknown,
): Promise<T> {
  const url = `http://127.0.0.1:${ctx.port}/api/works/${encodeURIComponent(ctx.workId)}${workPath}`;
  const res = await fetch(url, {
    method,
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: api ${method} ${workPath} → ${res.status} ${txt}\n`);
    process.exit(res.status >= 400 && res.status < 500 ? 4 : 3);
  }
  return (await res.json()) as T;
}
