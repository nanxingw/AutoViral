/**
 * Composition variables — declarative `${id}` interpolation for parametrized
 * compositions. Adopted from hyperframes' data-composition-variables (ADR-001).
 *
 * Public surface:
 *
 *   interpolate(source, vars, opts)         string→string substitution
 *   validateDeclarations(decls)             cross-field declaration checks
 *   validateOverrides(decls, vals, opts)    runtime override type-check
 *   resolve(composition, opts)              composition→ResolvedComposition
 *
 * The CLI's `--variables` and the bridge's POST /export consume `resolve()`.
 * The Studio Variables panel UI consumes `validateOverrides()` for inline
 * feedback as the user edits.
 */
export {
  interpolate,
  hasInterpolation,
  InterpolationError,
  type InterpolateOptions,
} from "./interpolate.js";

export {
  validateDeclarations,
  validateOverrides,
} from "./validate.js";

export {
  resolve,
  VariableResolutionError,
  type ResolveOptions,
  type ResolveResult,
} from "./resolve.js";

export type {
  VariableDeclaration,
  VariableType,
  VariableEnumOption,
  VariableValue,
  VariableValues,
  VariableIssue,
} from "./types.js";
