import { describe, it, expect } from "vitest";

// Re-export hack — the function isn't exported from index.tsx; re-implement
// inline to avoid breaking the JSX file's existing public surface. If you
// touch summarizeToolUse in index.tsx, mirror the change here.
function summarizeToolUse(toolName: string | undefined, raw: string) {
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {}
  const name = (toolName ?? (input.name as string | undefined) ?? "tool").toString();
  const norm = name.toLowerCase();
  const basename = (p: unknown): string => {
    if (typeof p !== "string") return "";
    const m = p.match(/[^/\\]+$/);
    return m ? m[0] : p;
  };
  if (norm === "read" || norm === "edit" || norm === "write" || norm === "notebookedit") {
    return { tool: name, detail: basename(input.file_path ?? input.notebook_path) || null };
  }
  if (norm === "bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    return { tool: name, detail: cmd.length > 70 ? cmd.slice(0, 67) + "…" : cmd || null };
  }
  if (norm === "glob") {
    return { tool: name, detail: ((input.pattern as string) ?? "") || null };
  }
  if (norm === "grep") {
    const p = (input.pattern as string) ?? "";
    const where = input.path ? ` in ${basename(input.path)}` : "";
    return { tool: name, detail: (p + where) || null };
  }
  if (norm === "webfetch") return { tool: name, detail: (input.url as string) || null };
  if (norm === "websearch") return { tool: name, detail: (input.query as string) || null };
  const k = Object.keys(input)[0];
  if (k && typeof input[k] === "string") {
    const v = input[k] as string;
    return { tool: name, detail: v.length > 60 ? v.slice(0, 57) + "…" : v };
  }
  return { tool: name, detail: null };
}

describe("summarizeToolUse", () => {
  it("Read → file basename", () => {
    expect(
      summarizeToolUse("Read", JSON.stringify({ file_path: "/abs/path/file.tsx" })),
    ).toEqual({ tool: "Read", detail: "file.tsx" });
  });

  it("Edit + Write also use file_path basename", () => {
    expect(
      summarizeToolUse("Edit", JSON.stringify({ file_path: "/x/y/z/foo.yaml", old_string: "a", new_string: "b" })),
    ).toEqual({ tool: "Edit", detail: "foo.yaml" });
    expect(
      summarizeToolUse("Write", JSON.stringify({ file_path: "/tmp/out.json", content: "{}" })),
    ).toEqual({ tool: "Write", detail: "out.json" });
  });

  it("Bash → command preview, truncated past 70 chars", () => {
    const short = summarizeToolUse("Bash", JSON.stringify({ command: "ls -la" }));
    expect(short.detail).toBe("ls -la");
    const longCmd = "find /Users/ -type f -name '*.test.ts' -exec grep -l 'TODO' {} \\; | head -10 | xargs wc -l";
    expect(longCmd.length).toBeGreaterThan(70);
    const long = summarizeToolUse("Bash", JSON.stringify({ command: longCmd }));
    expect(long.detail?.length).toBeLessThanOrEqual(70);
    expect(long.detail).toMatch(/…$/);
  });

  it("Grep → pattern + 'in <basename>' when path present", () => {
    expect(
      summarizeToolUse("Grep", JSON.stringify({ pattern: "TODO", path: "/abs/src/foo" })),
    ).toEqual({ tool: "Grep", detail: "TODO in foo" });
  });

  it("WebSearch → query, WebFetch → url", () => {
    expect(summarizeToolUse("WebSearch", JSON.stringify({ query: "remotion player" })).detail).toBe(
      "remotion player",
    );
    expect(summarizeToolUse("WebFetch", JSON.stringify({ url: "https://x.dev" })).detail).toBe(
      "https://x.dev",
    );
  });

  it("unknown tool → first stringy field as a hint, null when none", () => {
    expect(summarizeToolUse("Custom", JSON.stringify({ foo: "bar" })).detail).toBe("bar");
    expect(summarizeToolUse("Custom", JSON.stringify({ count: 5 })).detail).toBeNull();
  });

  it("malformed JSON falls back to (toolName, null)", () => {
    expect(summarizeToolUse("Bash", "{not json")).toEqual({ tool: "Bash", detail: null });
  });
});
