import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { readRecentReports, cleanupReports } from "./reports.js";
import { buildPrompt } from "./prompt.js";

export type OrchestratorState = "idle" | "running";

export interface CycleResult {
  success: boolean;
  duration: number;
  output: string;
}

class Orchestrator extends EventEmitter {
  state: OrchestratorState = "idle";
  lastRun: Date | null = null;
  lastResult: CycleResult | null = null;

  async runEvolutionCycle(): Promise<CycleResult> {
    if (this.state === "running") {
      throw new Error("Evolution cycle already running");
    }

    this.state = "running";
    this.emit("cycle_start");
    const startTime = Date.now();
    let output = "";

    try {
      const config = await loadConfig();
      const recentReports = await readRecentReports(config.reportsToFeed);
      const prompt = buildPrompt(recentReports);

      const result = await new Promise<CycleResult>((resolve, reject) => {
        const claude = spawn("claude", [
          "-p", prompt,
          "--output-format", "stream-json",
          "--model", config.model,
          "--permission-mode", "bypassPermissions",
          "--no-session-persistence",
        ], {
          cwd: homedir(),
          stdio: ["pipe", "pipe", "pipe"],
        });

        claude.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("Claude CLI not found. Please install Claude Code first."));
          } else {
            reject(err);
          }
        });

        let stderr = "";

        claude.stdout.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.type === "assistant" && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === "text" && block.text) {
                    output += block.text;
                    this.emit("cycle_progress", block.text);
                  }
                }
              }
              if (json.type === "result") {
                output = json.result ?? output;
              }
            } catch {
              // non-JSON line, ignore
            }
          }
        });

        claude.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        claude.on("close", (code) => {
          const duration = Date.now() - startTime;
          if (code === 0) {
            resolve({ success: true, duration, output });
          } else {
            reject(new Error(`Claude exited with code ${code}: ${stderr}`));
          }
        });
      });

      await cleanupReports(config.maxReports);

      this.lastRun = new Date();
      this.lastResult = result;
      this.state = "idle";
      this.emit("cycle_end", result);
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const result: CycleResult = {
        success: false,
        duration,
        output: err instanceof Error ? err.message : String(err),
      };
      this.lastRun = new Date();
      this.lastResult = result;
      this.state = "idle";
      this.emit("cycle_error", err);
      throw err;
    }
  }
}

export const orchestrator = new Orchestrator();
