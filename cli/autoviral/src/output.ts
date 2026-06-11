// Output formatter — JSON when piped, YAML when interactive, OR an explicit
// `--format json|yaml|table` that overrides the isTTY auto-detection.
//
// The isTTY split is intentional (see bridge-protocol §Output formats): agents
// pipe `autoviral list clips | jq ...` and want clean JSON, but a human user
// typing the same command interactively gets scannable YAML / table. The manual
// (03-cli-reference §Output format override) promises an EXPLICIT `--format`
// flag forces a direction REGARDLESS of isTTY — so e.g. `autoviral list clips
// --format table | cat` must still emit the ASCII table even though stdout is a
// pipe (isTTY === false). Without honoring the explicit flag over isTTY, that
// promise was a lie: a piped `--format table` silently fell back to JSON.

import { stringify as yamlStringify } from "yaml";

export type OutputFormat = "json" | "yaml" | "table";

/**
 * Parse a `--format json|yaml|table` flag out of an argv slice. Returns the
 * explicit format if present and valid, else `undefined` (→ isTTY default).
 * An unknown `--format <x>` value is treated as absent (the auto-detect default
 * applies) rather than throwing — read commands stay forgiving.
 */
export function parseFormatFlag(args: string[]): OutputFormat | undefined {
  const i = args.indexOf("--format");
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === "json" || v === "yaml" || v === "table") return v;
  return undefined;
}

/**
 * Write `data` to stdout. When `format` is given it WINS over isTTY (the
 * `--format` override contract); when omitted the legacy isTTY auto-detect
 * applies (JSON when piped, YAML/scalar when interactive).
 */
export function writeOut(data: unknown, format?: OutputFormat): void {
  const effective: OutputFormat =
    format ?? (process.stdout.isTTY ? "yaml" : "json");

  if (effective === "json") {
    process.stdout.write(JSON.stringify(data) + "\n");
    return;
  }
  if (effective === "table") {
    process.stdout.write(renderTable(data));
    return;
  }
  // yaml (the interactive default). A bare scalar prints as a line, not a YAML
  // document, so a human gets `3` not `3\n...` noise.
  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
    process.stdout.write(`${data}\n`);
    return;
  }
  process.stdout.write(yamlStringify(data));
}

/**
 * Render `data` as an ASCII column table. The common shape is an array of flat
 * objects (the projection rows `list clips` / `checkpoint list` return): the
 * union of keys becomes the header, one row per element, columns padded to the
 * widest cell. Non-array / non-object data falls back to YAML so the command
 * never crashes on an unexpected shape.
 */
function renderTable(data: unknown): string {
  if (!Array.isArray(data)) {
    // A single object → one-row table of its own keys; anything else → YAML.
    if (data && typeof data === "object") return renderTable([data]);
    return yamlStringify(data);
  }
  if (data.length === 0) return "(no rows)\n";
  const rows: Record<string, unknown>[] = data.map((r) =>
    r && typeof r === "object" && !Array.isArray(r)
      ? (r as Record<string, unknown>)
      : { value: r },
  );
  // Stable column order: first-seen key order across all rows.
  const cols: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  }
  const cell = (v: unknown): string =>
    v == null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => cell(r[c]).length)),
  );
  const fmtRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").replace(/\s+$/, "");
  const lines: string[] = [];
  lines.push(fmtRow(cols));
  lines.push(fmtRow(widths.map((w) => "-".repeat(w))));
  for (const row of rows) lines.push(fmtRow(cols.map((c) => cell(row[c]))));
  return lines.join("\n") + "\n";
}
