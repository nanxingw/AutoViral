import { describe, expect, it, afterEach } from "vitest";
import { PtyPool } from "../pty-pool.js";

describe("PtyPool — (workId, sessionId) keying (ADR-008)", () => {
  const pool = new PtyPool();
  afterEach(() => pool.disposeAll());

  it("spawns a pty keyed by (workId, sessionId), exposed on the session", async () => {
    const session = pool.spawn({
      workId: "w_test",
      sessionId: "s_1",
      cwd: process.cwd(),
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    expect(session.workId).toBe("w_test");
    expect(session.sessionId).toBe("s_1");
    expect(pool.get("w_test", "s_1")).toBe(session);
  });

  it("getOrSpawn RESUMES the same pty for a key (survives reconnect)", async () => {
    const a = pool.getOrSpawn({
      workId: "w_resume",
      sessionId: "s_1",
      cwd: process.cwd(),
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    // Second attach (e.g. a page reload) on the same key returns the SAME pty —
    // no fresh shell, scrollback intact in the running process.
    const b = pool.getOrSpawn({
      workId: "w_resume",
      sessionId: "s_1",
      cwd: process.cwd(),
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
    });
    expect(b).toBe(a);
  });

  it("different sessions on one work get different ptys (no cross-talk)", async () => {
    const s1 = pool.getOrSpawn({ workId: "w_multi", sessionId: "s_1", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    const s2 = pool.getOrSpawn({ workId: "w_multi", sessionId: "s_2", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    expect(s2).not.toBe(s1);
    expect(pool.get("w_multi", "s_1")).toBe(s1);
    expect(pool.get("w_multi", "s_2")).toBe(s2);
  });

  it("multi-attach fans output to every attached listener; detaching one leaves the pty alive", async () => {
    const session = pool.getOrSpawn({ workId: "w_attach", sessionId: "s_1", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    const tabA: string[] = [];
    const tabB: string[] = [];
    const offA = session.onData((d) => tabA.push(d));
    session.onData((d) => tabB.push(d));
    expect(pool.attachCount("w_attach", "s_1")).toBe(2);
    session.write("printf hello\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(tabA.join("")).toContain("hello");
    expect(tabB.join("")).toContain("hello"); // both tabs saw the same output
    // Detaching one tab must not kill the pty (survives reconnect).
    offA();
    expect(pool.attachCount("w_attach", "s_1")).toBe(1);
    expect(pool.get("w_attach", "s_1")).toBe(session);
  });

  it("dispose(workId, sessionId) kills the pty; disposeAll clears the pool", async () => {
    const session = pool.spawn({ workId: "w_del", sessionId: "s_3", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    expect(pool.get("w_del", "s_3")).toBe(session);
    pool.dispose("w_del", "s_3");
    expect(pool.get("w_del", "s_3")).toBeUndefined();
  });

  it("replayBuffer captures recent output so a reconnecting ws can restore scrollback", async () => {
    // ADR-008 §6 — getOrSpawn re-attaches the SAME pty on reload, but a freshly
    // attached ws missed all prior output. The pool's ring buffer is what
    // terminal-ws.ts replays to restore scrollback before live output resumes.
    const session = pool.getOrSpawn({ workId: "w_replay", sessionId: "s_1", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    // Drive output BEFORE any ws attaches (the reconnect-from-cold case).
    session.write("printf scrollback-marker\n");
    await new Promise((r) => setTimeout(r, 200));
    // A reconnecting ws would call replayBuffer first — it contains the prior
    // output even though no listener was attached when it was produced.
    expect(pool.replayBuffer("w_replay", "s_1")).toContain("scrollback-marker");
    // No pty for an unknown key → empty replay (no throw).
    expect(pool.replayBuffer("w_replay", "s_does_not_exist")).toBe("");
  });

  it("the pool key delimiter is collision-proof across (workId, sessionId) pairs", async () => {
    // The "::" delimiter cannot appear in a slug/counter id, so ("a", "b::c")
    // and ("a::b", "c") (which a bare-space key would conflate) stay distinct.
    const x = pool.getOrSpawn({ workId: "a", sessionId: "b::c", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    const y = pool.getOrSpawn({ workId: "a::b", sessionId: "c", cwd: process.cwd(), shell: "/bin/sh", cols: 80, rows: 24 });
    expect(y).not.toBe(x);
    expect(pool.get("a", "b::c")).toBe(x);
    expect(pool.get("a::b", "c")).toBe(y);
  });
});
