/**
 * Cross-field validation for variable declarations.
 *
 * Zod handles per-field shape (id pattern, label string, etc.) but cannot
 * cleanly express "default's type must match the declared `type` field"
 * because the latter is a discriminator. This module catches:
 *
 *   • id collisions across the array
 *   • default value type/shape mismatching declared `type`
 *   • enum without options[]
 *   • enum default not in options[]
 *
 * Returns a list of issues; an empty list means the declarations are
 * usable.
 */
import type {
  VariableDeclaration,
  VariableIssue,
  VariableValues,
} from "./types.js";

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isColorString(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR_RE.test(v);
}

export function validateDeclarations(
  declarations: ReadonlyArray<VariableDeclaration> | undefined,
): VariableIssue[] {
  const issues: VariableIssue[] = [];
  if (!declarations || declarations.length === 0) return issues;

  const seen = new Set<string>();
  for (const decl of declarations) {
    if (seen.has(decl.id)) {
      issues.push({
        severity: "error",
        ruleId: "id-duplicate",
        variableId: decl.id,
        message: `duplicate variable id "${decl.id}"`,
      });
      continue;
    }
    seen.add(decl.id);

    switch (decl.type) {
      case "string": {
        if (typeof decl.default !== "string") {
          issues.push({
            severity: "error",
            ruleId: "default-type-mismatch",
            variableId: decl.id,
            message: `variable "${decl.id}" (type=string) has default of type ${typeof decl.default}`,
          });
        }
        break;
      }
      case "number": {
        if (typeof decl.default !== "number" || !Number.isFinite(decl.default)) {
          issues.push({
            severity: "error",
            ruleId: "default-type-mismatch",
            variableId: decl.id,
            message: `variable "${decl.id}" (type=number) has non-numeric default ${JSON.stringify(decl.default)}`,
          });
        }
        break;
      }
      case "boolean": {
        if (typeof decl.default !== "boolean") {
          issues.push({
            severity: "error",
            ruleId: "default-type-mismatch",
            variableId: decl.id,
            message: `variable "${decl.id}" (type=boolean) has non-boolean default ${JSON.stringify(decl.default)}`,
          });
        }
        break;
      }
      case "color": {
        if (!isColorString(decl.default)) {
          issues.push({
            severity: "error",
            ruleId: "default-type-mismatch",
            variableId: decl.id,
            message: `variable "${decl.id}" (type=color) default must be #RGB / #RRGGBB / #RRGGBBAA; got ${JSON.stringify(decl.default)}`,
          });
        }
        break;
      }
      case "enum": {
        if (!decl.options || decl.options.length === 0) {
          issues.push({
            severity: "error",
            ruleId: "enum-options-missing",
            variableId: decl.id,
            message: `enum variable "${decl.id}" must declare options[]`,
          });
          break;
        }
        if (typeof decl.default !== "string") {
          issues.push({
            severity: "error",
            ruleId: "default-type-mismatch",
            variableId: decl.id,
            message: `enum variable "${decl.id}" default must be a string value, got ${typeof decl.default}`,
          });
          break;
        }
        if (!decl.options.some((o) => o.value === decl.default)) {
          issues.push({
            severity: "error",
            ruleId: "enum-default-not-in-options",
            variableId: decl.id,
            message: `enum variable "${decl.id}" default "${String(decl.default)}" is not in declared options`,
          });
        }
        break;
      }
    }
  }
  return issues;
}

/**
 * Validate a runtime overrides map against the declarations. Used by the
 * CLI's `--variables` flag and the per-instance `data-variable-values`
 * pathway.
 *
 * Strict mode (the default) reports any unknown keys; lenient mode silently
 * ignores them (useful when a wrapper script passes a superset).
 */
export function validateOverrides(
  declarations: ReadonlyArray<VariableDeclaration>,
  overrides: VariableValues,
  opts: { strict?: boolean } = {},
): VariableIssue[] {
  const issues: VariableIssue[] = [];
  const byId = new Map(declarations.map((d) => [d.id, d]));
  for (const [key, value] of Object.entries(overrides)) {
    const decl = byId.get(key);
    if (!decl) {
      if (opts.strict !== false) {
        issues.push({
          severity: "error",
          ruleId: "override-unknown-key",
          variableId: key,
          message: `override key "${key}" does not match any declared variable`,
        });
      }
      continue;
    }
    switch (decl.type) {
      case "string":
        if (typeof value !== "string") {
          issues.push({
            severity: "error",
            ruleId: "override-type-mismatch",
            variableId: key,
            message: `override for "${key}" must be string, got ${typeof value}`,
          });
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({
            severity: "error",
            ruleId: "override-type-mismatch",
            variableId: key,
            message: `override for "${key}" must be a finite number, got ${JSON.stringify(value)}`,
          });
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          issues.push({
            severity: "error",
            ruleId: "override-type-mismatch",
            variableId: key,
            message: `override for "${key}" must be boolean, got ${typeof value}`,
          });
        }
        break;
      case "color":
        if (!isColorString(value)) {
          issues.push({
            severity: "error",
            ruleId: "override-type-mismatch",
            variableId: key,
            message: `override for "${key}" must be a hex color, got ${JSON.stringify(value)}`,
          });
        }
        break;
      case "enum": {
        if (typeof value !== "string") {
          issues.push({
            severity: "error",
            ruleId: "override-type-mismatch",
            variableId: key,
            message: `enum override for "${key}" must be a string value`,
          });
          break;
        }
        if (
          decl.options &&
          !decl.options.some((o) => o.value === value)
        ) {
          issues.push({
            severity: "error",
            ruleId: "override-enum-not-in-options",
            variableId: key,
            message: `enum override "${key}=${value}" not in declared options`,
          });
        }
        break;
      }
    }
  }
  return issues;
}
