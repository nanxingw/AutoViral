/**
 * Public types for the composition variables engine.
 *
 * Re-exports the source-of-truth schema types from the shared composition
 * module so callers don't have to know that VariableDeclaration is
 * physically defined in `src/shared/composition.ts`.
 */
export type {
  VariableDeclaration,
  VariableType,
  VariableEnumOption,
} from "../../shared/composition.js";

/** Concrete value bound to a variable id (already type-coerced). */
export type VariableValue = string | number | boolean;

/** A map from variable id → concrete value. */
export type VariableValues = Record<string, VariableValue>;

/** A finding produced by `validateDeclarations()` or `resolve()`. */
export interface VariableIssue {
  severity: "error" | "warning";
  /** Stable rule id for filtering/diffing in CI. */
  ruleId:
    | "id-invalid"
    | "id-duplicate"
    | "default-type-mismatch"
    | "enum-options-missing"
    | "enum-default-not-in-options"
    | "override-type-mismatch"
    | "override-enum-not-in-options"
    | "override-unknown-key";
  /** Variable id the issue applies to, or null for top-level issues. */
  variableId: string | null;
  /** Human-readable explanation. Includes the offending value when useful. */
  message: string;
}
