import { spawn } from "node:child_process";
import { homedir } from "node:os";

/** Run claude CLI with a prompt and return the text result. */
// Default 180s — trends WebSearch + JSON synthesis routinely exceeds 60s
// for cold-start agent calls. Callers that know their workload is faster
// can pass a smaller timeoutMs.
export function runCliBrief(prompt: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--dangerously-skip-permissions",
      "--model", "haiku",
    ];

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
    });

    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error("Timeout"));
    }, timeoutMs);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(`CLI exited with code ${code}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        resolve(envelope.result ?? "");
      } catch {
        resolve(stdout);
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
