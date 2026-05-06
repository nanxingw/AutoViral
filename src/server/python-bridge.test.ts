import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock node:child_process so spawn() returns a controllable EventEmitter.
// Each call to runPythonScript() captures the most recent handle on
// globalThis.__spawnHandle so individual tests can drive its event timing.
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      (globalThis as any).__spawnHandle = proc;
      return proc;
    }),
  };
});

import { runPythonScript } from "./python-bridge.js";

describe("runPythonScript", () => {
  beforeEach(() => {
    (globalThis as any).__spawnHandle = null;
  });

  it("resolves with parsed JSON when child exits 0", async () => {
    const promise = runPythonScript("/x.py", ["--a", "1"], { timeoutMs: 1000 });
    // Allow the Promise body to register its listeners on the EventEmitter
    // before we drive the events.
    await Promise.resolve();
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from('{"hello":"world"}'));
    proc.emit("close", 0);
    const result = await promise;
    expect(result).toEqual({ hello: "world" });
  });

  it("rejects when child exits non-zero, including stderr in the error", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    await Promise.resolve();
    const proc = (globalThis as any).__spawnHandle;
    proc.stderr.emit("data", Buffer.from("boom: bad arg"));
    proc.emit("close", 2);
    await expect(promise).rejects.toThrow(/exit 2/);
  });

  it("forwards stderr text in the rejection error message (separate from stdout)", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    await Promise.resolve();
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from('{"ignored":true}\n'));
    proc.stderr.emit("data", Buffer.from("diagnostic-on-stderr"));
    proc.emit("close", 1);
    await expect(promise).rejects.toThrow(/diagnostic-on-stderr/);
  });

  it("rejects when stdout is not valid JSON", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    await Promise.resolve();
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from("not json"));
    proc.emit("close", 0);
    await expect(promise).rejects.toThrow(/JSON/i);
  });

  it("rejects with timeout error and SIGKILLs the child after timeoutMs", async () => {
    vi.useFakeTimers();
    const promise = runPythonScript("/x.py", [], { timeoutMs: 50 });
    // Capture the spawn handle synchronously; vi.useFakeTimers leaves
    // microtasks alone so the Promise body has already run.
    const proc = (globalThis as any).__spawnHandle;
    vi.advanceTimersByTime(60);
    // The kill handler synchronously emits 'close' in real Node; here we
    // simulate that so the Promise resolves to its timeout rejection.
    proc.emit("close", null);
    await expect(promise).rejects.toThrow(/timed out/i);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("uses the last non-empty stdout line as the JSON payload (script may log earlier)", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    await Promise.resolve();
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from('"intermediate diagnostic"\n'));
    proc.stdout.emit("data", Buffer.from('{"final":true}\n'));
    proc.emit("close", 0);
    expect(await promise).toEqual({ final: true });
  });
});
