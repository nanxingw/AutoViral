import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { readRecentReports, cleanupReports } from "./reports.js";
import { buildPrompt } from "./prompt.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type JobType = "evolution" | "post-task" | "task";

export interface ExecutionJob {
  id: string;
  type: JobType;
  prompt: string;
  model: string;
  taskId?: string;
  taskName?: string;
}

export interface ExecutionResult {
  success: boolean;
  duration: number;
  output: string;
  jobId: string;
  jobType: JobType;
}

// Backward-compatible aliases
export type OrchestratorState = "idle" | "running";
export type CycleResult = ExecutionResult;

// ── Executor ─────────────────────────────────────────────────────────────────

class Executor extends EventEmitter {
  running: Map<string, ExecutionJob> = new Map();
  lastRun: Date | null = null;
  lastResult: ExecutionResult | null = null;

  /** Backward-compatible state: "running" if any job is active. */
  get state(): OrchestratorState {
    return this.running.size > 0 ? "running" : "idle";
  }

  get activeCount(): number {
    return this.running.size;
  }

  get isIdle(): boolean {
    return this.running.size === 0;
  }

  async run(job: ExecutionJob): Promise<ExecutionResult> {
    this.running.set(job.id, job);
    this.emit("job_start", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName });

    // Backward compat: emit cycle_start for evolution jobs
    if (job.type === "evolution") {
      this.emit("cycle_start");
    }

    const startTime = Date.now();
    let output = "";

    try {
      const result = await new Promise<ExecutionResult>((resolve, reject) => {
        const claude = spawn("claude", [
          "-p", job.prompt,
          "--output-format", "stream-json",
          "--verbose",
          "--model", job.model,
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ], {
          cwd: homedir(),
          stdio: ["ignore", "pipe", "pipe"],
          env: (() => {
            const env = { ...process.env };
            delete env.CLAUDECODE;
            return env;
          })(),
        });

        claude.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("Claude CLI not found. Please install Claude Code first."));
          } else {
            reject(err);
          }
        });

        let stderr = "";
        let buffer = "";

        claude.stdout.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);

              if (json.type === "system" && json.subtype === "init") {
                const text = `[init] model=${json.model} session=${json.session_id}\n`;
                this.emit("job_progress", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, text });
                if (job.type === "evolution") this.emit("cycle_progress", text);
                continue;
              }

              if (json.type === "assistant" && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === "text" && block.text) {
                    output += block.text;
                    this.emit("job_progress", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, text: block.text });
                    if (job.type === "evolution") this.emit("cycle_progress", block.text);
                  }
                  if (block.type === "tool_use") {
                    const inputPreview = typeof block.input === "object"
                      ? (block.input.command || block.input.pattern || block.input.file_path || block.input.content?.substring(0, 80) || "").toString().substring(0, 120)
                      : "";
                    const text = `[${block.name}] ${inputPreview}\n`;
                    this.emit("job_progress", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, text });
                    if (job.type === "evolution") this.emit("cycle_progress", text);
                  }
                }
                continue;
              }

              if (json.type === "tool_result") {
                const text = `[result] \u2713\n`;
                this.emit("job_progress", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, text });
                if (job.type === "evolution") this.emit("cycle_progress", text);
                continue;
              }

              if (json.type === "result") {
                output = json.result ?? output;
                const text = `\n[done] cost=$${json.cost_usd ?? "?"} duration=${json.duration_ms ?? "?"}ms\n`;
                this.emit("job_progress", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, text });
                if (job.type === "evolution") this.emit("cycle_progress", text);
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
            resolve({ success: true, duration, output, jobId: job.id, jobType: job.type });
          } else {
            reject(new Error(`Claude exited with code ${code}: ${stderr}`));
          }
        });
      });

      this.running.delete(job.id);
      this.lastRun = new Date();
      this.lastResult = result;

      this.emit("job_end", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, result });
      if (job.type === "evolution") this.emit("cycle_end", result);

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const result: ExecutionResult = {
        success: false,
        duration,
        output: err instanceof Error ? err.message : String(err),
        jobId: job.id,
        jobType: job.type,
      };

      this.running.delete(job.id);
      this.lastRun = new Date();
      this.lastResult = result;

      this.emit("job_error", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName, error: err });
      if (job.type === "evolution") this.emit("cycle_error", err);

      throw err;
    }
  }
}

export const executor = new Executor();

// Backward-compatible alias
export const orchestrator = executor;

// ── Convenience: run an evolution cycle ──────────────────────────────────────

let evolutionCounter = 0;

export async function runEvolutionCycle(): Promise<ExecutionResult> {
  const config = await loadConfig();
  const recentReports = await readRecentReports(config.reportsToFeed);
  const prompt = buildPrompt(recentReports, { taskAutoApprove: config.taskAutoApprove });

  const job: ExecutionJob = {
    id: `evolution-${++evolutionCounter}-${Date.now()}`,
    type: "evolution",
    prompt,
    model: config.model,
  };

  const result = await executor.run(job);
  await cleanupReports(config.maxReports);
  return result;
}
