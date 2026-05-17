/**
 * Resolve a composition's variables — produce a deep-cloned composition
 * with every `${id}` token in string fields replaced by its concrete
 * value.
 *
 * Order of precedence (later wins):
 *   1. Declared `default`
 *   2. Composition-level overrides (currently none; reserved for future)
 *   3. Caller-supplied overrides (the `--variables` CLI flag, or a per-
 *      instance `data-variable-values` map)
 *
 * Non-string fields are passed through unchanged. Numeric/boolean variable
 * values stringify at substitution sites — this lets you write
 * `style.color: "${themeColor}"` (the variable's hex value lands there) or
 * `text: "Q4 ${year}"` (number stringifies).
 *
 * The function NEVER mutates the input composition; it returns a fresh
 * object that's safe to pass to the renderer.
 */
import type { Composition } from "../../shared/composition.js";
import { interpolate, hasInterpolation, InterpolationError } from "./interpolate.js";
import type {
  VariableValues,
  VariableIssue,
  VariableValue,
} from "./types.js";
import { validateDeclarations, validateOverrides } from "./validate.js";

export interface ResolveOptions {
  /** Caller-supplied overrides (e.g. CLI `--variables '{}'`). */
  overrides?: VariableValues;
  /** If true, throw on validation errors or interpolation misses. */
  strict?: boolean;
}

export interface ResolveResult {
  /** Deep-cloned composition with interpolations applied. */
  composition: Composition;
  /** Merged values map (declared defaults + overrides). */
  resolvedValues: VariableValues;
  /** Validation issues from declarations + overrides. Empty when clean. */
  issues: VariableIssue[];
}

export class VariableResolutionError extends Error {
  constructor(
    public readonly issues: VariableIssue[],
    msg = "variable resolution failed",
  ) {
    super(`${msg}: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "VariableResolutionError";
  }
}

/**
 * Build the values map: declared defaults overlaid by overrides.
 */
function mergeValues(
  declarations: Composition["variables"],
  overrides: VariableValues = {},
): VariableValues {
  const merged: VariableValues = {};
  if (declarations) {
    for (const d of declarations) {
      merged[d.id] = d.default as VariableValue;
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    merged[k] = v;
  }
  return merged;
}

/**
 * Recursively walk an object/array tree, returning a deep clone in which
 * every string leaf has been passed through `interpolate`. Non-string
 * primitives, null, undefined, Date, etc. pass through untouched. Arrays
 * and plain objects are recursed.
 *
 * Interpolation NEVER throws here — strict mode is enforced at the
 * resolve() boundary by collecting interpolation issues into the issue
 * list before deciding whether to throw VariableResolutionError. This
 * guarantees the caller sees ALL problems at once (declaration +
 * override + missing-token) rather than getting whichever happens to
 * fail first.
 */
function interpolateTree<T>(
  node: T,
  vars: VariableValues,
  issues: VariableIssue[],
): T {
  if (typeof node === "string") {
    if (!hasInterpolation(node)) return node;
    try {
      return interpolate(node, vars, { strict: true }) as unknown as T;
    } catch (err) {
      if (err instanceof InterpolationError) {
        issues.push({
          severity: "error",
          ruleId: "override-unknown-key",
          variableId: err.key,
          message: `string field references unknown variable "${err.key}"`,
        });
        // Leave the token literal in the cloned tree (lenient fallback).
        return interpolate(node, vars, { strict: false }) as unknown as T;
      }
      throw err;
    }
  }
  if (Array.isArray(node)) {
    return node.map((item) =>
      interpolateTree(item, vars, issues),
    ) as unknown as T;
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = interpolateTree(v, vars, issues);
    }
    return out as unknown as T;
  }
  return node;
}

export function resolve(
  composition: Composition,
  opts: ResolveOptions = {},
): ResolveResult {
  const declarations = composition.variables;
  const overrides = opts.overrides ?? {};
  const strict = opts.strict === true;

  // Collect ALL issues across declaration / override / interpolation
  // before deciding whether to throw. This way the caller sees the
  // complete picture in one shot rather than chasing whichever check
  // fails first.
  const issues: VariableIssue[] = [
    ...validateDeclarations(declarations),
    ...validateOverrides(declarations ?? [], overrides, { strict }),
  ];

  const resolvedValues = mergeValues(declarations, overrides);
  const interpolated = interpolateTree(composition, resolvedValues, issues);

  if (strict && issues.some((i) => i.severity === "error")) {
    throw new VariableResolutionError(issues);
  }

  return { composition: interpolated, resolvedValues, issues };
}
