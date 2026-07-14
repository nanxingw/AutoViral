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

// BE3-F3 (PRD-0010) — every request here hits the local Studio daemon, whose
// synchronous generation routes (`scene generate` → openrouter-image, i2v, …)
// can hold the connection open for MINUTES. A bare `fetch` has no explicit
// ceiling and, when a long generation outlasts undici's implicit timeout or the
// socket drops, rejects with the opaque `TypeError: fetch failed`. Bubbled
// through cli.ts's top-level catch that becomes `autoviral: fetch failed`
// (generic exit 3) — an agent can't tell that apart from a transient service
// failure, so it retries, and the server (which kept generating) bills twice.
//
// So every request gets an EXPLICIT, generous, configurable ceiling; on a
// client-side timeout / dropped connection we emit a CLEAR, agent-actionable
// message + the canonical timeout exit code 124 (the same signal `ask` uses),
// never the opaque `fetch failed`. The default ceiling (10 min) is high enough
// that real generations complete; AUTOVIRAL_HTTP_TIMEOUT_MS overrides it (tests
// inject a short value; a user with an unusually slow provider can raise it).
export const DEFAULT_HTTP_TIMEOUT_MS = 600_000; // 10 minutes

// BE3-F3 review fix — a SINGLE 10-min ceiling for every route was a regression
// for `ingest youtube`, whose header contract (commands/ingest.ts) documents
// that agents "should not timeout client-side under ~15 min for typical 5–10
// minute YouTube clips" (download + Whisper ASR + translation all block the one
// HTTP response). Capping it at the generic 10 min would abort a legit long
// ingest. So the caller passes its own generous per-call budget; ingest uses
// this one, comfortably above its ~15-min floor. (CAVEAT: undici's own implicit
// headersTimeout — ~5 min by default in current Node — can still fire earlier
// for a route that sends NO response bytes until it finishes, which ingest does;
// raising that further would need a custom undici dispatcher, deliberately out
// of scope here since this CLI is intentionally dependency-free. This constant
// removes OUR self-inflicted 10-min cap and keeps the explicit budget aligned
// with the documented contract.)
export const INGEST_TIMEOUT_MS = 1_200_000; // 20 minutes

// Resolve the effective request budget. `AUTOVIRAL_HTTP_TIMEOUT_MS`, when set to
// a positive finite number, is an explicit user override that wins over any
// per-call fallback; otherwise the caller's `fallbackMs` (default: the generic
// 10-min ceiling) applies.
export function httpTimeoutMs(fallbackMs: number = DEFAULT_HTTP_TIMEOUT_MS): number {
  const raw = process.env.AUTOVIRAL_HTTP_TIMEOUT_MS;
  if (raw === undefined) return fallbackMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

// A timeout-class fetch rejection: our own AbortSignal.timeout (a "TimeoutError"
// DOMException) OR undici's implicit headers/body/socket/connect timeouts and a
// mid-flight reset, which surface as `TypeError: fetch failed` with a coded
// `.cause`. All mean the same thing to the agent: the request did not complete
// but the server MAY have — so retrying blindly risks a double charge.
function isTimeoutish(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; cause?: { code?: unknown; name?: unknown } };
    if (e.name === "TimeoutError" || e.name === "AbortError") return true;
    const code = e.cause?.code;
    if (
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_ABORTED" ||
      code === "ECONNRESET"
    ) {
      return true;
    }
  }
  return false;
}

// fetch with the BE3-F3 explicit ceiling + error reclassification. On a
// client-side timeout / dropped connection it does NOT return — it prints the
// clear guidance and exits 124; any other network error exits 3. A normal
// response (ANY HTTP status) is handed back to the caller for its own status
// handling, so the {ok,result} / 4xx-vs-5xx exit-code contract is untouched.
async function fetchWithBudget(
  url: string,
  init: RequestInit,
  label: string,
  fallbackMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const budget = httpTimeoutMs(fallbackMs);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(budget) });
  } catch (err) {
    if (isTimeoutish(err)) {
      const dur = budget >= 1000 ? `${Math.round(budget / 1000)}s` : `${budget}ms`;
      process.stderr.write(
        `autoviral: ${label} timed out after ${dur} — the Studio may STILL be ` +
          `generating (and may already have been billed). Do NOT blindly retry: ` +
          `check the work state first, or raise AUTOVIRAL_HTTP_TIMEOUT_MS if this ` +
          `generation legitimately needs longer.\n`,
      );
      process.exit(124);
    }
    process.stderr.write(
      `autoviral: ${label} failed — ${(err as Error)?.message ?? String(err)}\n`,
    );
    process.exit(3);
  }
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
  // BE3-F3 review fix — a route with a longer documented SLA than the generic
  // 10-min ceiling (e.g. `ingest youtube`, ~15 min) passes its own budget here.
  // AUTOVIRAL_HTTP_TIMEOUT_MS still overrides it (see httpTimeoutMs).
  opts?: { timeoutMs?: number },
): Promise<T> {
  const url = `http://127.0.0.1:${ctx.port}/api/bridge/v1${path}`;
  const res = await fetchWithBudget(
    url,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": ctx.workId,
      },
      body: body == null ? undefined : JSON.stringify(body),
    },
    `bridge ${method} ${path}`,
    opts?.timeoutMs,
  );
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
  const res = await fetchWithBudget(
    url,
    {
      method,
      headers: body == null ? undefined : { "Content-Type": "text/markdown; charset=utf-8" },
      body: body == null ? undefined : body,
    },
    `api ${method} ${workPath}`,
  );
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
  return apiJsonAbs<T>(
    ctx,
    method,
    `/api/works/${encodeURIComponent(ctx.workId)}${workPath}`,
    body,
  );
}

// JSON request against an ABSOLUTE `/api/...` route that is NOT nested under
// `/api/works/:workId` (NOR the bridge `{ok,result}` envelope). Used by the
// render-queue lifecycle (PRD-0014 S11): `render status/cancel` hit
// `/api/render/jobs/:id` — a top-level route, not a per-work one — which returns
// a BARE RenderJob (or `{ error, errorCode }` with a 4xx/5xx status). Same
// exit-code contract as bridgeRequest / apiJson: 4 = your input was wrong (4xx),
// 3 = the service broke (5xx / malformed response). The caller passes the full
// `/api/...` path.
export async function apiJsonAbs<T>(
  ctx: BridgeContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  body?: unknown,
): Promise<T> {
  const url = `http://127.0.0.1:${ctx.port}${apiPath}`;
  const res = await fetchWithBudget(
    url,
    {
      method,
      headers: body == null ? undefined : { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    },
    `api ${method} ${apiPath}`,
  );
  if (!res.ok) {
    const txt = await res.text();
    process.stderr.write(`autoviral: api ${method} ${apiPath} → ${res.status} ${txt}\n`);
    process.exit(res.status >= 400 && res.status < 500 ? 4 : 3);
  }
  return (await res.json()) as T;
}
