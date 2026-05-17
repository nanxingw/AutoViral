/**
 * `${id}` string interpolation engine.
 *
 * Replaces `${identifier}` tokens with concrete values from a vars map.
 * Identifier grammar: `[a-zA-Z_][a-zA-Z0-9_]*` — matches the same identifier
 * pattern enforced by VariableDeclarationSchema. No expressions, no nested
 * substitution, no escapes.
 *
 * Missing keys:
 *   • lenient mode (default): leave the `${unknown}` token literal
 *   • strict mode: throw a typed error including the missing key name
 *
 * Numbers and booleans are stringified at the substitution site so they
 * can appear in string fields (e.g. `text: "Q4 ${year}"` or
 * `data-loop: "${enabled}"`). Colors are already strings (hex), so they
 * substitute as-is.
 */
import type { VariableValues } from "./types.js";

const TOKEN_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export interface InterpolateOptions {
  /** If true, throw on unknown keys instead of leaving the token literal. */
  strict?: boolean;
}

export class InterpolationError extends Error {
  constructor(
    public readonly key: string,
    public readonly source: string,
  ) {
    super(`Unknown variable "${key}" referenced in: ${source}`);
    this.name = "InterpolationError";
  }
}

export function interpolate(
  source: string,
  vars: VariableValues,
  opts: InterpolateOptions = {},
): string {
  return source.replace(TOKEN_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key];
      return typeof value === "string" ? value : String(value);
    }
    if (opts.strict) {
      throw new InterpolationError(key, source);
    }
    return match;
  });
}

/** Quick predicate: does this string contain any interpolation tokens? */
export function hasInterpolation(source: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(source);
}
