// Output formatter — JSON when piped, YAML when interactive.
//
// This isTTY split is intentional (see bridge-protocol §Output formats):
// agents pipe `autoviral list clips | jq ...` and want clean JSON, but a
// human user typing the same command interactively gets scannable YAML.

import { stringify as yamlStringify } from "yaml";

export function writeOut(data: unknown): void {
  if (process.stdout.isTTY) {
    if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
      process.stdout.write(`${data}\n`);
    } else {
      process.stdout.write(yamlStringify(data));
    }
  } else {
    process.stdout.write(JSON.stringify(data) + "\n");
  }
}
