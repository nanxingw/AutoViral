// src/server/python-bridge.ts
//
// Thin wrapper around child_process.spawn for invoking Python smart-crop and
// other AutoViral pipeline scripts.
//
// Contract with the called script:
//   * stdout: the LAST non-empty line MUST be a JSON document. Anything before
//     that may be diagnostics, but parsers will discard it.
//   * stderr: free-form diagnostics. Captured for inclusion in error messages.
//   * exit code: 0 = success; non-zero = failure (rejection includes stderr).
//
// Default timeout 60s; configurable per-call. On timeout we SIGKILL the child
// and reject with a "timed out after Nms" Error whose `.cause` carries the
// stderr accumulated up to the kill.

import { spawn } from "node:child_process";

export interface RunPythonOptions {
  /** Milliseconds before SIGKILL. Default 60_000. */
  timeoutMs?: number;
  /** Override the Python binary. Default "python3". */
  python?: string;
  /** cwd for the spawned process. Default process.cwd(). */
  cwd?: string;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string>;
}

export async function runPythonScript<T = unknown>(
  scriptPath: string,
  args: string[] = [],
  opts: RunPythonOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const python = opts.python ?? "python3";

  return new Promise<T>((resolve, reject) => {
    const child = spawn(python, [scriptPath, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const killTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer | string) => {
      stdout += typeof b === "string" ? b : b.toString();
    });
    child.stderr.on("data", (b: Buffer | string) => {
      stderr += typeof b === "string" ? b : b.toString();
    });

    child.on("close", (code: number | null) => {
      clearTimeout(killTimer);
      if (timedOut) {
        const err = new Error(
          `runPythonScript: ${scriptPath} timed out after ${timeoutMs}ms\n${stderr}`,
        );
        (err as Error & { cause?: unknown }).cause = stderr;
        settle(() => reject(err));
        return;
      }
      if (code !== 0) {
        const err = new Error(
          `runPythonScript: ${scriptPath} exit ${code}\n${stderr}`,
        );
        (err as Error & { cause?: unknown }).cause = stderr;
        settle(() => reject(err));
        return;
      }
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) {
        settle(() =>
          reject(new Error(`runPythonScript: ${scriptPath} produced no stdout`)),
        );
        return;
      }
      try {
        const parsed = JSON.parse(last) as T;
        settle(() => resolve(parsed));
      } catch (e) {
        settle(() =>
          reject(
            new Error(
              `runPythonScript: ${scriptPath} stdout is not valid JSON: ${(e as Error).message}\nlast line: ${last}`,
            ),
          ),
        );
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(killTimer);
      settle(() => reject(err));
    });
  });
}
