import { describe, it, expect } from "vitest";
import { interpolate, hasInterpolation, InterpolationError } from "../interpolate.js";

describe("interpolate (H2.1)", () => {
  it("substitutes a single ${id} token", () => {
    expect(interpolate("${title}", { title: "Pro" })).toBe("Pro");
  });

  it("substitutes multiple tokens in one string", () => {
    expect(
      interpolate("${title} costs ${price}", { title: "Pro", price: "$29" }),
    ).toBe("Pro costs $29");
  });

  it("repeats a token if it appears twice", () => {
    expect(interpolate("${x}-${x}", { x: "hi" })).toBe("hi-hi");
  });

  it("stringifies numbers at substitution sites", () => {
    expect(interpolate("Year ${year}", { year: 2026 })).toBe("Year 2026");
  });

  it("stringifies booleans at substitution sites", () => {
    expect(interpolate("loop=${enabled}", { enabled: true })).toBe(
      "loop=true",
    );
  });

  it("leaves unmatched ${unknown} literal in lenient mode (default)", () => {
    expect(interpolate("Hello ${unknown}", {})).toBe("Hello ${unknown}");
  });

  it("throws InterpolationError on missing key in strict mode", () => {
    expect(() =>
      interpolate("${title}", { x: "y" }, { strict: true }),
    ).toThrow(InterpolationError);
  });

  it("the thrown error carries the missing key + source for debugging", () => {
    try {
      interpolate("a ${missing_one} b", { other: 1 }, { strict: true });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InterpolationError);
      expect((e as InterpolationError).key).toBe("missing_one");
      expect((e as InterpolationError).source).toContain("missing_one");
    }
  });

  it("does not substitute tokens with non-identifier characters", () => {
    // ${1foo} starts with digit — invalid identifier, not matched
    expect(interpolate("${1foo}", { "1foo": "bad" })).toBe("${1foo}");
    // ${foo-bar} has a hyphen — invalid identifier, not matched
    expect(interpolate("${foo-bar}", { "foo-bar": "no" })).toBe(
      "${foo-bar}",
    );
  });

  it("does not nest substitutions (no expression evaluation)", () => {
    // ${a} resolves to "${b}" but is not recursively re-interpolated
    expect(interpolate("${a}", { a: "${b}", b: "deep" })).toBe("${b}");
  });

  it("preserves surrounding whitespace and punctuation", () => {
    expect(
      interpolate("  hello, ${name}!  ", { name: "world" }),
    ).toBe("  hello, world!  ");
  });

  it("handles underscore identifiers", () => {
    expect(interpolate("${a_b_c}", { a_b_c: "x" })).toBe("x");
  });

  it("hasInterpolation returns true only when a token is present", () => {
    expect(hasInterpolation("${a}")).toBe(true);
    expect(hasInterpolation("plain text")).toBe(false);
    expect(hasInterpolation("$money but no curly")).toBe(false);
    expect(hasInterpolation("${1bad}")).toBe(false); // invalid id, no match
  });

  // ─── Property test — random alphanumeric ids interpolate correctly ─────
  it("(property) random alphanumeric ids substitute correctly across 100 samples", () => {
    function randomIdentifier(rng: () => number): string {
      const lead = "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const rest = lead + "0123456789";
      const len = 1 + Math.floor(rng() * 12);
      let s = lead.charAt(Math.floor(rng() * lead.length));
      for (let i = 1; i < len; i++) {
        s += rest.charAt(Math.floor(rng() * rest.length));
      }
      return s;
    }
    // mulberry32 — deterministic seeded PRNG so the test is reproducible
    let state = 0x9e3779b9 ^ 0x12345678;
    const rng = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 100; i++) {
      const id = randomIdentifier(rng);
      const value = `value_${i}`;
      const source = `prefix ${"${" + id + "}"} suffix`;
      const out = interpolate(source, { [id]: value });
      expect(out).toBe(`prefix ${value} suffix`);
    }
  });
});
