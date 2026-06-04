# Exit codes — canonical table

The `autoviral` CLI exits with one of these codes. Branch on them in shell pipelines; never parse stdout for error state.

| Code | Meaning | When it fires |
|---|---|---|
| `0` | Success | All happy paths; `ask` answered **yes** / **ok** |
| `1` | User said "no" | `ask --yes-no` answered no |
| `2` | Wrong state | Missing `AUTOVIRAL_WORK_ID` env, or Studio unreachable on `AUTOVIRAL_PORT`; `ask` cancelled |
| `3` | Protocol / service error | Bridge returned `5xx`, malformed/non-JSON response, schema mismatch, network error mid-call |
| `4` | Validation error | Bad CLI args, missing required flags, bridge returned any HTTP `4xx` (its `400`s carry `code: 4`) |
| `124` | Timeout | `ask` not answered within `--timeout` (default 30 min) |
| `127` | Unknown subcommand | Typo: `autoviral whomai`, `autoviral klip`, etc. |

## HTTP error shape

When the bridge rejects a request, the response body is:

```json
{ "ok": false, "error": "humanly readable", "code": 4 }
```

The CLI surfaces `error` on stderr and exits with the `code`. Don't ignore stderr — it carries the actionable message.

How the CLI picks its exit code from a bridge failure:

1. If the response body carries a numeric `code`, the CLI exits with **exactly that** (`4` for validation `400`s, `124` for an `/ask` `504` timeout).
2. Otherwise it maps the HTTP status class: any **`4xx` → exit 4** (input/validation), any **`5xx` → exit 3** (service).
3. A non-JSON error body (proxy / HTML error page) is tolerated — it falls back to the status-class mapping, never crashes.
4. A `200 OK` with `{ ok: false }` (a business-level failure) honours an explicit `code`, else exits `3`.

Every clip + carousel write endpoint emits `code: 4` on its `400`s, so `autoviral clip …` failures branch `4` (your patch was rejected) vs `3` (the bridge broke) reliably.

## Idioms

### "Did `ask` say yes?"

```bash
if autoviral ask "Render now?" --yes-no; then
  autoviral export
fi
```

`if` treats exit 0 as success. Don't use `&&` if you need to distinguish "no" from "timeout" — `&&` runs the right side only on exit 0, but doesn't tell you which non-zero you got.

### "Was the user 'no' vs 'cancelled' vs timeout?"

```bash
answer=$(autoviral ask "Apply changes?" --ok-cancel)
case $? in
  0)   echo "user said ok";       autoviral toast "Applying" ;;
  2)   echo "user cancelled";     exit 0 ;;
  124) echo "timed out";          autoviral toast "Timed out — bailing" --kind warn ;;
  *)   echo "protocol error: $?"; exit 1 ;;
esac
```

The CLI also prints the canonical answer (`yes` / `no` / `cancelled`) to stdout, so `answer=$(autoviral ask ...)` works.

### "Is the Studio even running?"

```bash
if ! autoviral whoami > /dev/null 2>&1; then
  echo "Not in a Studio terminal; bailing." >&2
  exit 1
fi
```

`whoami` is the smoke test. Exit 2 = env vars unset or backend unreachable.

### "The bridge rejected my patch — was it validation?"

```bash
if ! autoviral clip set vc_s07 --out 0; then
  case $? in
    4) echo "validation error — check stderr for the zod issues" ;;
    3) echo "protocol error — bridge probably restarted" ;;
    *) echo "unexpected: $?" ;;
  esac
fi
```

A `--out 0` patch fails validation because `out` must be `> in` and `in` defaults to 0 — exit 4 with a clear message.

## What the CLI never does on error

- Never half-writes `composition.yaml` (atomic rename guarantees this)
- Never retries automatically — if you want retries, wrap the CLI yourself
- Never prints success message before the operation completes
- Never silently swallows errors — every non-zero exit comes with a stderr line

## Mapping CLI exit codes to bridge HTTP codes

| CLI exit | Bridge response |
|---|---|
| `0` | `200 OK` `{ ok: true, result: ... }` |
| `1` | `200 OK` `{ ok: true, result: { answer: "no" } }` (from `/ask`) |
| `2` | Connection refused / env missing / `{ ok: true, result: { answer: "cancelled" } }` |
| `3` | `5xx`, malformed JSON, or unexpected schema |
| `4` | `400 Bad Request` `{ ok: false, error: ..., code: 4 }` |
| `124` | `504 Gateway Timeout` (from `/ask` blocking endpoint) |
| `127` | n/a — CLI never sends the request |

Power users hitting the HTTP API directly should expect the same error shape; the CLI is the canonical interface but not the only one.
