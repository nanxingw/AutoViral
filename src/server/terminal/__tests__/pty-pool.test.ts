import { describe, expect, it, afterEach } from "vitest";
import { PtyPool } from "../pty-pool.js";

describe("PtyPool", () => {
  const pool = new PtyPool();
  afterEach(() => pool.disposeAll());

  it("spawns a pty bound to workspace cwd + env, returns id", async () => {
    const cwd = process.cwd();
    const session = pool.spawn({
      workId: "w_test",
      cwd,
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    expect(session.id).toMatch(/^pty_/);
    expect(session.workId).toBe("w_test");
    expect(pool.get(session.id)).toBe(session);
  });

  it("forwards data → echo → onData; disposing kills the process", async () => {
    const session = pool.spawn({
      workId: "w_test2",
      cwd: process.cwd(),
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    const chunks: string[] = [];
    session.onData((d) => chunks.push(d));
    session.write("printf hello\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(chunks.join("")).toContain("hello");
    pool.dispose(session.id);
    expect(pool.get(session.id)).toBeUndefined();
  });
});
