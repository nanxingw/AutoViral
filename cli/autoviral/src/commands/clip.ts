// `autoviral clip add|set|remove|split` — composition.yaml write surface.
//
// All three sub-verbs round-trip through the bridge so the canonical
// disk state is always the server's (no local edit-then-push). The
// server validates via zod before atomic-renaming the file — invalid
// patches leave the on-disk composition untouched.

import { bridgeRequest, readContext } from "../client.js";

export async function clipCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const ctx = readContext();

  if (sub === "add") {
    const opts = parseFlags(rest);
    const track = opts["--track"] ?? "video";
    if (track === "text") {
      if (!opts["--text"]) {
        process.stderr.write("autoviral clip add --track text: --text required\n");
        process.exit(4);
      }
    } else {
      if (!opts["--src"]) {
        process.stderr.write("autoviral clip add: --src required\n");
        process.exit(4);
      }
    }
    const body: Record<string, unknown> = {
      src: opts["--src"],
      text: opts["--text"],
      track,
      offset: opts["--offset"] ? Number(opts["--offset"]) : 0,
      duration: opts["--duration"] ? Number(opts["--duration"]) : undefined,
      in: opts["--in"] ? Number(opts["--in"]) : undefined,
      out: opts["--out"] ? Number(opts["--out"]) : undefined,
    };
    const result = await bridgeRequest<{ id: string }>(ctx, "POST", "/clip", body);
    process.stdout.write(`${result.id}\n`);
    return;
  }

  if (sub === "remove") {
    const id = rest[0];
    if (!id) {
      process.stderr.write("usage: autoviral clip remove <id>\n");
      process.exit(4);
    }
    await bridgeRequest(ctx, "DELETE", `/clip/${encodeURIComponent(id)}`, undefined);
    return;
  }

  if (sub === "split") {
    // S6 (US 1/9) — `autoviral clip split <id> --at <sec>`. The bridge runs the
    // shared `ops.splitClip` (same code the Studio UI uses), so the two paths
    // produce an identical composition. We validate the args locally (exit 4,
    // never hits the bridge) so an obviously-malformed invocation fails fast.
    const id = rest[0];
    if (!id || id.startsWith("--")) {
      process.stderr.write("usage: autoviral clip split <id> --at <seconds>\n");
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const atRaw = opts["--at"];
    const at = atRaw === undefined ? NaN : Number(atRaw);
    if (!Number.isFinite(at)) {
      process.stderr.write("autoviral clip split: --at <seconds> required\n");
      process.exit(4);
    }
    const result = await bridgeRequest<{ id: string }>(ctx, "POST", "/split", {
      clipId: id,
      at,
    });
    process.stdout.write(`${result.id}\n`);
    return;
  }

  if (sub === "set") {
    const id = rest[0];
    if (!id) {
      process.stderr.write("usage: autoviral clip set <id> [--key value]...\n");
      process.exit(4);
    }
    const opts = parseFlags(rest.slice(1));
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
      const flag = k.replace(/^--/, "");
      // S11 — map ergonomic CLI flags to the canonical nested composition path
      // (`--scale` → `transforms.scale`, `--brightness` → `filters.brightness`,
      // …). An unmapped flag falls through verbatim, so a fully-qualified
      // dotted key (`--transforms.scale`) also works. The server's per-kind
      // whitelist rejects anything unknown with exit 4 — never a silent no-op.
      const path = CLIP_SET_FLAG_PATHS[flag] ?? flag;
      const value = parseFlagValue(v);
      // S11 fix-up — the server's per-kind whitelist only lists DOTTED LEAVES
      // (`ducking.ratio`, never a bare `ducking`). So an OBJECT-valued flag
      // (`--ducking '{"ratio":0.4}'`) must be FLATTENED into `{ "ducking.ratio":
      // 0.4 }` before it leaves the CLI — otherwise the bare-`ducking` key is
      // not whitelisted and the bridge 400s the documented ergonomic (code:4).
      // Flattening also deep-merges (each leaf lands independently) instead of
      // replacing the whole sub-object and dropping its other fields.
      flattenInto(patch, path, value);
    }
    await bridgeRequest(ctx, "PATCH", `/clip/${encodeURIComponent(id)}`, patch);
    return;
  }

  process.stderr.write(`autoviral clip: unknown subcommand "${sub ?? ""}"\n`);
  process.exit(127);
}

// S11 — ergonomic short flags → canonical nested composition paths. The server
// (`ops.patchClipProps`) owns the per-kind whitelist; this map only spares the
// agent from typing the dotted path for the common cases. Any flag absent here
// is forwarded verbatim, so `--transforms.scale 2` (fully qualified) is equally
// valid. Keep this in lockstep with the schema fields in src/shared/composition.
const CLIP_SET_FLAG_PATHS: Record<string, string> = {
  // video transforms
  scale: "transforms.scale",
  x: "transforms.x",
  y: "transforms.y",
  rotation: "transforms.rotation",
  // video filters
  lut: "filters.lut",
  brightness: "filters.brightness",
  contrast: "filters.contrast",
  saturation: "filters.saturation",
  // audio
  "fade-in": "fadeIn",
  "fade-out": "fadeOut",
  // text style
  font: "style.font",
  size: "style.size",
  weight: "style.weight",
  italic: "style.italic",
  tracking: "style.tracking",
  color: "style.color",
  // text position
  anchor: "position.anchor",
  // overlay / shared scalars (src, in, out, trackOffset, volume, opacity, type,
  // text, duration, animation) already match their canonical key verbatim.
};

// S11 — coerce a raw CLI string flag value into the JSON shape the server
// expects. Numbers and booleans are typed; a value that parses as JSON
// (object/array/quoted-string) is parsed (so `--ducking '{"ratio":0.4}'` parses
// to an object, which `flattenInto` then splits into `ducking.ratio` dot-paths
// the server whitelists); everything else stays a bare string. Mirrors the
// schema's leaf types.
function parseFlagValue(v: string): unknown {
  if (v === undefined) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(v)) return Number(v);
  if (/^[[{]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      // fall through — treat a malformed JSON literal as a plain string
    }
  }
  return v;
}

// S11 fix-up — write `value` under `prefix` into `patch`, but if `value` is a
// plain object, recurse so each leaf becomes its own dot-path key. This keeps
// the wire format aligned with the server's whitelist (`patchClipProps`), which
// only accepts dotted leaves (`ducking.ratio`), never a bare object key
// (`ducking`). `--ducking '{"ratio":0.4,"attack":0.1}'` →
// `{ "ducking.ratio":0.4, "ducking.attack":0.1 }`. Arrays and scalars are
// written as-is (a leaf value stays a leaf). Empty objects are dropped — they
// carry no leaf to whitelist and would otherwise smuggle a bare key through.
function flattenInto(
  patch: Record<string, unknown>,
  prefix: string,
  value: unknown,
): void {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      flattenInto(patch, `${prefix}.${k}`, v);
    }
    return;
  }
  patch[prefix] = value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k] = argv[i + 1];
      i++;
    }
  }
  return out;
}
