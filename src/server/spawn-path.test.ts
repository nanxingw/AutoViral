import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { repairSpawnPath, ensureSpawnPath } from "./spawn-path.js";

describe("repairSpawnPath (pure)", () => {
  it("appends the missing Homebrew bin dir on darwin, preserving existing order", () => {
    // The real daemon bug: harness-started PATH has /usr/local/bin but not
    // /opt/homebrew/bin, so Apple-Silicon Homebrew ffmpeg/ffprobe are unfindable.
    const before = "/usr/local/bin:/usr/bin:/bin";
    const after = repairSpawnPath(before, "darwin");
    expect(after.split(":")).toContain("/opt/homebrew/bin");
    // Existing entries keep their precedence — missing dirs are appended, not prepended.
    expect(after.startsWith("/usr/local/bin:/usr/bin:/bin")).toBe(true);
  });

  it("is idempotent — a PATH that already has every canonical dir is returned unchanged", () => {
    const full = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/some/other";
    expect(repairSpawnPath(full, "darwin")).toBe(full);
  });

  it("does not duplicate a dir that is already present", () => {
    const before = "/opt/homebrew/bin:/usr/bin";
    const after = repairSpawnPath(before, "darwin");
    const occurrences = after.split(":").filter((d) => d === "/opt/homebrew/bin").length;
    expect(occurrences).toBe(1);
  });

  it("leaves PATH untouched on non-darwin platforms", () => {
    const before = "/usr/bin:/bin";
    expect(repairSpawnPath(before, "linux")).toBe(before);
    expect(repairSpawnPath(before, "win32")).toBe(before);
  });

  it("handles an undefined PATH on darwin by returning the canonical dirs", () => {
    const after = repairSpawnPath(undefined, "darwin");
    expect(after.split(":")).toContain("/opt/homebrew/bin");
    expect(after.split(":")).toContain("/usr/local/bin");
  });

  it("drops empty segments so it never emits a stray ':' lookup", () => {
    const after = repairSpawnPath("/usr/bin::", "darwin");
    expect(after.split(":")).not.toContain("");
  });
});

describe("ensureSpawnPath (mutating, idempotent)", () => {
  const original = process.env.PATH;
  beforeEach(() => {
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
  });
  afterEach(() => {
    process.env.PATH = original;
  });

  it("repairs process.env.PATH in place when running on darwin", () => {
    if (process.platform !== "darwin") return; // platform-guarded behaviour
    ensureSpawnPath();
    expect(process.env.PATH!.split(":")).toContain("/opt/homebrew/bin");
  });

  it("is safe to call twice (no accumulation)", () => {
    if (process.platform !== "darwin") return;
    ensureSpawnPath();
    const once = process.env.PATH;
    ensureSpawnPath();
    expect(process.env.PATH).toBe(once);
  });
});
