import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { readRecentReports, cleanupReports, getReportsDir } from "./reports.js";
import {
  buildPrompt,
  buildContextAgentPrompt,
  buildSkillAgentPrompt,
  buildTaskAgentPrompt,
} from "./prompt.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type JobType = "evolution" | "post-task" | "task" | "evo-context" | "evo-skill" | "evo-task";

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

export interface MultiAgentResult {
  context: ExecutionResult | null;
  skill: ExecutionResult | null;
  task: ExecutionResult | null;
  totalDuration: number;
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

  /** Check if any evolution-related job is running */
  get hasEvolutionRunning(): boolean {
    return Array.from(this.running.values()).some(
      j => j.type === "evolution" || j.type === "evo-context" || j.type === "evo-skill" || j.type === "evo-task",
    );
  }

  async run(job: ExecutionJob): Promise<ExecutionResult> {
    this.running.set(job.id, job);
    this.emit("job_start", { jobId: job.id, jobType: job.type, taskId: job.taskId, taskName: job.taskName });

    // Backward compat: emit cycle_start for evolution jobs
    if (job.type === "evolution") {
      this.emit("cycle_start");
    }
    // Multi-agent: emit cycle_start on first evo-* job
    if (job.type === "evo-context" || job.type === "evo-skill" || job.type === "evo-task") {
      const evoJobs = Array.from(this.running.values()).filter(
        j => j.type === "evo-context" || j.type === "evo-skill" || j.type === "evo-task",
      );
      if (evoJobs.length === 1) {
        this.emit("cycle_start");
      }
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

  if (config.evolutionMode === "multi") {
    const multiResult = await runMultiAgentEvolution();
    // Return a synthetic ExecutionResult for backward compat
    return {
      success: (multiResult.context?.success ?? true) && (multiResult.skill?.success ?? true) && (multiResult.task?.success ?? true),
      duration: multiResult.totalDuration,
      output: `Multi-agent cycle completed. Context: ${multiResult.context?.success ?? "skipped"}, Skill: ${multiResult.skill?.success ?? "skipped"}, Task: ${multiResult.task?.success ?? "skipped"}`,
      jobId: `evolution-multi-${++evolutionCounter}-${Date.now()}`,
      jobType: "evolution",
    };
  }

  // Single-agent mode (backward compat)
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

// ── Multi-agent evolution ────────────────────────────────────────────────────

function currentTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}_${hh}-${mm}`;
}

export async function runMultiAgentEvolution(): Promise<MultiAgentResult> {
  const config = await loadConfig();
  const recentReports = await readRecentReports(config.reportsToFeed);
  const ts = currentTimestamp();
  const reportsDir = getReportsDir();

  const contextReportPath = join(reportsDir, `${ts}_context_report.md`);
  const skillReportPath = join(reportsDir, `${ts}_skill_report.md`);
  const taskReportPath = join(reportsDir, `${ts}_task_report.md`);
  const mergedReportPath = join(reportsDir, `${ts}_report.md`);

  const contextPrompt = buildContextAgentPrompt(recentReports, contextReportPath);
  const skillPrompt = buildSkillAgentPrompt(recentReports, skillReportPath);
  const taskPrompt = buildTaskAgentPrompt(recentReports, taskReportPath, {
    taskAutoApprove: config.taskAutoApprove,
  });

  const startTime = Date.now();
  const counter = ++evolutionCounter;

  // Run three agents in parallel
  const [contextSettled, skillSettled, taskSettled] = await Promise.allSettled([
    executor.run({
      id: `evo-context-${counter}-${Date.now()}`,
      type: "evo-context",
      prompt: contextPrompt,
      model: config.model,
    }),
    executor.run({
      id: `evo-skill-${counter}-${Date.now()}`,
      type: "evo-skill",
      prompt: skillPrompt,
      model: config.model,
    }),
    executor.run({
      id: `evo-task-${counter}-${Date.now()}`,
      type: "evo-task",
      prompt: taskPrompt,
      model: config.model,
    }),
  ]);

  const contextResult = contextSettled.status === "fulfilled" ? contextSettled.value : null;
  const skillResult = skillSettled.status === "fulfilled" ? skillSettled.value : null;
  const taskResult = taskSettled.status === "fulfilled" ? taskSettled.value : null;

  const totalDuration = Date.now() - startTime;

  // Merge sub-reports into a combined report
  await mergeReports(mergedReportPath, {
    contextPath: contextReportPath,
    skillPath: skillReportPath,
    taskPath: taskReportPath,
    contextResult,
    skillResult,
    taskResult,
    totalDuration,
  });

  // Emit cycle_end with synthetic result
  const syntheticResult: ExecutionResult = {
    success: (contextResult?.success ?? false) || (skillResult?.success ?? false) || (taskResult?.success ?? false),
    duration: totalDuration,
    output: "Multi-agent evolution cycle completed",
    jobId: `evolution-multi-${counter}`,
    jobType: "evolution",
  };
  executor.lastRun = new Date();
  executor.lastResult = syntheticResult;
  executor.emit("cycle_end", syntheticResult);

  await cleanupReports(config.maxReports);

  return { context: contextResult, skill: skillResult, task: taskResult, totalDuration };
}

async function mergeReports(
  outputPath: string,
  opts: {
    contextPath: string;
    skillPath: string;
    taskPath: string;
    contextResult: ExecutionResult | null;
    skillResult: ExecutionResult | null;
    taskResult: ExecutionResult | null;
    totalDuration: number;
  },
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const { ensureDir } = await import("./config.js");
  const { dirname } = await import("node:path");

  await ensureDir(dirname(outputPath));

  let contextReport = "";
  let skillReport = "";
  let taskReport = "";

  try { contextReport = await readFile(opts.contextPath, "utf-8"); } catch { /* agent may not have written it */ }
  try { skillReport = await readFile(opts.skillPath, "utf-8"); } catch { /* agent may not have written it */ }
  try { taskReport = await readFile(opts.taskPath, "utf-8"); } catch { /* agent may not have written it */ }

  const statusLine = (result: ExecutionResult | null, name: string): string => {
    if (!result) return `${name}: FAILED`;
    return `${name}: ${result.success ? "OK" : "FAILED"} (${Math.round(result.duration / 1000)}s)`;
  };

  const merged = `# Evolution Report (Multi-Agent) — ${new Date().toISOString()}

## Summary

- ${statusLine(opts.contextResult, "Context Agent")}
- ${statusLine(opts.skillResult, "Skill Agent")}
- ${statusLine(opts.taskResult, "Task Agent")}
- Total duration: ${Math.round(opts.totalDuration / 1000)}s

---

## Context Agent

${contextReport || "_Agent did not produce a report._"}

---

## Skill Agent

${skillReport || "_Agent did not produce a report._"}

---

## Task Agent

${taskReport || "_Agent did not produce a report._"}
`;

  await writeFile(outputPath, merged, "utf-8");
}
