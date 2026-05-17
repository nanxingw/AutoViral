import { describe, it, expect } from "vitest";
import { resolve, VariableResolutionError } from "../resolve.js";
import { makeEmptyComposition } from "../../../shared/composition.js";
import type { Composition } from "../../../shared/composition.js";

function withVars(
  base: Composition,
  variables: Composition["variables"],
): Composition {
  return { ...base, variables };
}

function withTextClip(base: Composition, text: string): Composition {
  return {
    ...base,
    tracks: [
      {
        id: "trk_t",
        kind: "text",
        name: "text",
        order: 0,
        clips: [
          {
            id: "tc_1",
            kind: "text",
            text,
            trackOffset: 0,
            durationSec: 3,
            style: { color: "${accent}" } as never,
          } as never,
        ],
      } as never,
    ],
  };
}

describe("resolve (H2.1)", () => {
  it("no-op when composition has no variables (lenient)", () => {
    const c = makeEmptyComposition({ workId: "w_noop" });
    const r = resolve(c);
    expect(r.composition).toEqual(c);
    expect(r.resolvedValues).toEqual({});
    expect(r.issues).toEqual([]);
  });

  it("returns a deep clone (does not mutate input)", () => {
    const base = makeEmptyComposition({ workId: "w_clone" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "Hello" },
    ]);
    const r = resolve(c);
    // Original is untouched
    expect(c.tracks[0]?.clips[0]).toMatchObject({ text: "${title}" });
    // Clone has substitution applied
    expect(r.composition.tracks[0]?.clips[0]).toMatchObject({
      text: "Hello",
    });
    // Object identity differs
    expect(r.composition).not.toBe(c);
    expect(r.composition.tracks).not.toBe(c.tracks);
    expect(r.composition.tracks[0]?.clips).not.toBe(c.tracks[0]?.clips);
  });

  it("declared default is used when no override is supplied", () => {
    const base = makeEmptyComposition({ workId: "w_default" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "Default" },
    ]);
    const r = resolve(c);
    expect((r.composition.tracks[0]!.clips[0] as { text: string }).text).toBe(
      "Default",
    );
  });

  it("override beats default", () => {
    const base = makeEmptyComposition({ workId: "w_over" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "Default" },
    ]);
    const r = resolve(c, { overrides: { title: "Custom" } });
    expect((r.composition.tracks[0]!.clips[0] as { text: string }).text).toBe(
      "Custom",
    );
  });

  it("multiple variables in one string interpolate together", () => {
    const base = makeEmptyComposition({ workId: "w_multi" });
    const c = withVars(withTextClip(base, "${title} costs ${price}"), [
      { id: "title", type: "string", label: "T", default: "Pro" },
      { id: "price", type: "string", label: "P", default: "$29" },
    ]);
    const r = resolve(c);
    expect((r.composition.tracks[0]!.clips[0] as { text: string }).text).toBe(
      "Pro costs $29",
    );
  });

  it("substitutes inside deeply nested style fields too", () => {
    const base = makeEmptyComposition({ workId: "w_deep" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "X" },
      { id: "accent", type: "color", label: "A", default: "#abcdef" },
    ]);
    const r = resolve(c);
    expect(
      (r.composition.tracks[0]!.clips[0] as { style: { color: string } })
        .style.color,
    ).toBe("#abcdef");
  });

  it("number variable stringifies in text contexts", () => {
    const base = makeEmptyComposition({ workId: "w_num" });
    const c = withVars(withTextClip(base, "Year ${year}"), [
      { id: "year", type: "number", label: "Y", default: 2026 },
    ]);
    const r = resolve(c);
    expect(
      (r.composition.tracks[0]!.clips[0] as { text: string }).text,
    ).toBe("Year 2026");
  });

  it("strict mode throws on declaration default-type-mismatch", () => {
    const base = makeEmptyComposition({ workId: "w_strict_bad" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "number", label: "T", default: "oops" as never },
    ]);
    expect(() => resolve(c, { strict: true })).toThrow(VariableResolutionError);
  });

  it("strict mode throws on unknown override key", () => {
    const base = makeEmptyComposition({ workId: "w_strict_unknown" });
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "X" },
    ]);
    expect(() =>
      resolve(c, { overrides: { unknown_key: "y" }, strict: true }),
    ).toThrow(VariableResolutionError);
  });

  it("lenient mode collects unknown-token issues but still produces a composition", () => {
    const base = makeEmptyComposition({ workId: "w_lenient" });
    // withTextClip injects style.color="${accent}" — we deliberately
    // don't declare accent to exercise the lenient path.
    const c = withVars(withTextClip(base, "${title}"), [
      { id: "title", type: "string", label: "T", default: "X" },
    ]);
    const r = resolve(c, { overrides: { unknown: "y" } });
    // Lenient default: validateOverrides does NOT flag unknown override
    // keys, but interpolateTree DOES flag unknown variables referenced
    // in the composition body (a genuinely actionable warning even when
    // we're not erroring).
    const tokens = r.issues.filter(
      (i) => i.ruleId === "override-unknown-key",
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.variableId).toBe("accent");
    // Composition still produced; declared variable was substituted,
    // undeclared one left literal.
    expect(
      (r.composition.tracks[0]!.clips[0] as { text: string }).text,
    ).toBe("X");
    expect(
      (
        r.composition.tracks[0]!.clips[0] as { style: { color: string } }
      ).style.color,
    ).toBe("${accent}");
  });

  it("makeEmptyComposition still works untouched (no `variables` key)", () => {
    const c = makeEmptyComposition({ workId: "w_helper_compat" });
    expect(c.variables).toBeUndefined();
    // Resolve is a no-op
    const r = resolve(c);
    expect(r.composition.variables).toBeUndefined();
  });
});
