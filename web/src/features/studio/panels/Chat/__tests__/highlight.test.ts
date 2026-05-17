import { describe, it, expect } from "vitest";
import { highlightCode } from "../highlight";

describe("highlightCode", () => {
  it("yaml: tags keys, strings, numbers, booleans, comments", () => {
    const src = `# top comment\nname: "Foo Bar"\ncount: 42\nactive: true`;
    const out = highlightCode(src, "yaml").filter(([, c]) => c);
    const cls = out.map(([, c]) => c);
    expect(cls).toContain("hl-comment");
    expect(cls).toContain("hl-key");
    expect(cls).toContain("hl-str");
    expect(cls).toContain("hl-num");
    expect(cls).toContain("hl-bool");
  });

  it("yaml: `- ` list bullet tagged as punctuation", () => {
    const out = highlightCode(`items:\n  - foo\n  - bar`, "yaml").filter(([, c]) => c);
    expect(out.some(([t, c]) => c === "hl-punct" && t.includes("- "))).toBe(true);
  });

  it("json: distinguishes key strings from value strings", () => {
    const out = highlightCode(`{"name":"Foo","count":42}`, "json");
    const keys = out.filter(([, c]) => c === "hl-key").map(([t]) => t);
    const strs = out.filter(([, c]) => c === "hl-str").map(([t]) => t);
    // Two keys ("name", "count" — both followed by `:`), one string value ("Foo")
    expect(keys.length).toBe(2);
    expect(strs.length).toBe(1);
    expect(keys.some((t) => t.startsWith('"name"'))).toBe(true);
    expect(keys.some((t) => t.startsWith('"count"'))).toBe(true);
    expect(strs[0]).toBe('"Foo"');
  });

  it("bash: first word on line tagged as command, --flag tagged as flag", () => {
    const out = highlightCode(`ls -la /tmp\nfind . -name '*.ts'`, "bash");
    const cmds = out.filter(([, c]) => c === "hl-cmd").map(([t]) => t.trim());
    const flags = out.filter(([, c]) => c === "hl-flag").map(([t]) => t.trim());
    expect(cmds).toEqual(["ls", "find"]);
    expect(flags).toContain("-la");
    expect(flags).toContain("-name");
  });

  it("unknown language passes through as a single plain token", () => {
    const src = "any text whatever";
    const out = highlightCode(src, "rust");
    expect(out).toEqual([[src, ""]]);
  });

  it("preserves all source bytes (no character loss across tokenisation)", () => {
    const cases: Array<[string, "yaml" | "json" | "bash"]> = [
      [`name: "ok"\ncount: 1`, "yaml"],
      [`{"a": 1, "b": "x"}`, "json"],
      [`echo "hi" && ls -la`, "bash"],
    ];
    for (const [src, lang] of cases) {
      const joined = highlightCode(src, lang).map(([t]) => t).join("");
      expect(joined, `lang=${lang}`).toBe(src);
    }
  });
});
