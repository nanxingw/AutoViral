import { describe, it, expect } from "vitest";
import { validateDeclarations, validateOverrides } from "../validate.js";
import type { VariableDeclaration } from "../types.js";

describe("validateDeclarations (H2.1)", () => {
  it("returns empty issue list for an empty/missing declarations", () => {
    expect(validateDeclarations(undefined)).toEqual([]);
    expect(validateDeclarations([])).toEqual([]);
  });

  it("accepts a well-formed string declaration", () => {
    expect(
      validateDeclarations([
        { id: "title", type: "string", label: "Title", default: "Hello" },
      ]),
    ).toEqual([]);
  });

  it("rejects a string default on a number variable", () => {
    const issues = validateDeclarations([
      { id: "n", type: "number", label: "N", default: "oops" as never },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("default-type-mismatch");
    expect(issues[0]?.variableId).toBe("n");
  });

  it("rejects NaN / Infinity on a number variable", () => {
    expect(
      validateDeclarations([
        { id: "x", type: "number", label: "x", default: NaN as never },
      ])[0]?.ruleId,
    ).toBe("default-type-mismatch");
    expect(
      validateDeclarations([
        { id: "y", type: "number", label: "y", default: Infinity as never },
      ])[0]?.ruleId,
    ).toBe("default-type-mismatch");
  });

  it("rejects non-boolean default on boolean variable", () => {
    const issues = validateDeclarations([
      { id: "b", type: "boolean", label: "B", default: "yes" as never },
    ]);
    expect(issues[0]?.ruleId).toBe("default-type-mismatch");
  });

  it("accepts well-formed color (#RGB, #RRGGBB, #RRGGBBAA)", () => {
    expect(
      validateDeclarations([
        { id: "c1", type: "color", label: "c", default: "#abc" },
        { id: "c2", type: "color", label: "c", default: "#a1b2c3" },
        { id: "c3", type: "color", label: "c", default: "#a1b2c3ff" },
      ]),
    ).toEqual([]);
  });

  it("rejects malformed color", () => {
    expect(
      validateDeclarations([
        { id: "c", type: "color", label: "c", default: "red" as never },
      ])[0]?.ruleId,
    ).toBe("default-type-mismatch");
    expect(
      validateDeclarations([
        { id: "c", type: "color", label: "c", default: "#GG0000" as never },
      ])[0]?.ruleId,
    ).toBe("default-type-mismatch");
  });

  it("flags enum declaration without options", () => {
    const issues = validateDeclarations([
      { id: "theme", type: "enum", label: "Theme", default: "light" } as VariableDeclaration,
    ]);
    expect(issues[0]?.ruleId).toBe("enum-options-missing");
  });

  it("flags enum default not in options", () => {
    const issues = validateDeclarations([
      {
        id: "theme",
        type: "enum",
        label: "Theme",
        default: "neon" as never,
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
    ]);
    expect(issues[0]?.ruleId).toBe("enum-default-not-in-options");
  });

  it("flags duplicate ids", () => {
    const issues = validateDeclarations([
      { id: "x", type: "string", label: "X", default: "a" },
      { id: "x", type: "string", label: "X", default: "b" },
    ]);
    expect(issues[0]?.ruleId).toBe("id-duplicate");
    expect(issues[0]?.variableId).toBe("x");
  });
});

describe("validateOverrides (H2.1)", () => {
  const decls: VariableDeclaration[] = [
    { id: "title", type: "string", label: "T", default: "Hi" },
    { id: "year", type: "number", label: "Y", default: 2026 },
    { id: "enabled", type: "boolean", label: "E", default: true },
    { id: "accent", type: "color", label: "A", default: "#a8c5d6" },
    {
      id: "theme",
      type: "enum",
      label: "Theme",
      default: "light",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
  ];

  it("accepts a valid override of every type", () => {
    expect(
      validateOverrides(decls, {
        title: "Pro",
        year: 2027,
        enabled: false,
        accent: "#ff0000",
        theme: "dark",
      }),
    ).toEqual([]);
  });

  it("rejects a number override that is a string", () => {
    expect(
      validateOverrides(decls, { year: "2027" as never })[0]?.ruleId,
    ).toBe("override-type-mismatch");
  });

  it("rejects a color override that's not hex", () => {
    expect(
      validateOverrides(decls, { accent: "red" as never })[0]?.ruleId,
    ).toBe("override-type-mismatch");
  });

  it("rejects an enum override not in declared options", () => {
    expect(validateOverrides(decls, { theme: "neon" })[0]?.ruleId).toBe(
      "override-enum-not-in-options",
    );
  });

  it("strict mode flags unknown override keys", () => {
    expect(
      validateOverrides(decls, { does_not_exist: "x" }, { strict: true })[0]
        ?.ruleId,
    ).toBe("override-unknown-key");
  });

  it("lenient mode silently ignores unknown keys", () => {
    expect(
      validateOverrides(decls, { does_not_exist: "x" }, { strict: false }),
    ).toEqual([]);
  });
});
