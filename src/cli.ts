import { Command } from "commander";
import { loadConfig, saveConfig, type Config, getConfigDir } from "./config.js";
import { executor, runEvolutionCycle } from "./executor.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PID_FILE = join(homedir(), ".skill-evolver", "daemon.pid");
const LOG_FILE = join(homedir(), ".skill-evolver", "daemon.log");

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(PID_FILE, "utf-8");
    return parseInt(raw.trim(), 10);
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runCLI(): void {
  const program = new Command();

  program
    .name("skill-evolver")
    .description("Create and evolve Claude Code skills automatically")
    .version("0.1.0");

  program
    .command("start")
    .description("Start the skill-evolver daemon")
    .option("--foreground", "Run in foreground (don't daemonize)")
    .action(async (opts: { foreground?: boolean }) => {
      const existingPid = await readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Daemon already running (PID ${existingPid})`);
        console.log(`Run 'skill-evolver stop' first, then start again.`);
        return;
      }

      // If not --foreground and not already a spawned daemon, fork to background
      if (!opts.foreground && !process.env.__SKILL_EVOLVER_DAEMON) {
        await mkdir(getConfigDir(), { recursive: true });
        const fs = await import("node:fs");
        const logFd = fs.openSync(LOG_FILE, "a");
        const entryScript = process.argv[1];
        const child = spawn(process.execPath, [entryScript, "start", "--foreground"], {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, __SKILL_EVOLVER_DAEMON: "1" },
        });
        child.unref();
        fs.closeSync(logFd);
        // Wait briefly for PID file to be written
        await new Promise(r => setTimeout(r, 1500));
        const pid = await readPid();
        const config = await loadConfig();
        console.log(`skill-evolver daemon started (PID ${pid ?? child.pid})`);
        console.log(`Dashboard: http://localhost:${config.port}`);
        console.log(`Logs: ${LOG_FILE}`);
        return;
      }

      const config = await loadConfig();
      await writeFile(PID_FILE, String(process.pid), "utf-8");

      console.log(`Starting skill-evolver daemon (PID ${process.pid})`);
      console.log(`Interval: ${config.interval}, Model: ${config.model}`);

      if (config.autoRun) {
        startScheduler(config.interval);
        console.log("Scheduler started");
      }

      // Start web server
      const { startServer } = await import("./server/index.js");
      const { wsBroadcast } = startServer(config.port);
      console.log(`Dashboard: http://localhost:${config.port}`);

      // Bridge executor events → WebSocket broadcast
      executor.on("cycle_start", () => {
        wsBroadcast.broadcast("cycle_start", {});
      });
      executor.on("cycle_progress", (text: string) => {
        wsBroadcast.broadcast("cycle_progress", { text });
      });
      executor.on("cycle_end", (result: unknown) => {
        wsBroadcast.broadcast("cycle_end", { result });
      });
      executor.on("cycle_error", (err: unknown) => {
        wsBroadcast.broadcast("cycle_error", {
          message: err instanceof Error ? err.message : String(err),
        });
      });
      // Job-level events for tasks
      executor.on("job_start", (data: unknown) => {
        wsBroadcast.broadcast("job_start", data);
      });
      executor.on("job_progress", (data: unknown) => {
        wsBroadcast.broadcast("job_progress", data);
      });
      executor.on("job_end", (data: unknown) => {
        wsBroadcast.broadcast("job_end", data);
      });
      executor.on("job_error", (data: unknown) => {
        wsBroadcast.broadcast("job_error", data);
      });

      // Keep process alive
      process.on("SIGTERM", async () => {
        console.log("\nShutting down...");
        stopScheduler();
        try { await unlink(PID_FILE); } catch { /* ignore */ }
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        stopScheduler();
        try { await unlink(PID_FILE); } catch { /* ignore */ }
        process.exit(0);
      });
    });

  program
    .command("stop")
    .description("Stop the skill-evolver daemon")
    .action(async () => {
      const pid = await readPid();
      if (!pid) {
        console.log("No daemon PID file found");
        return;
      }
      if (!isProcessRunning(pid)) {
        console.log("Daemon not running, cleaning up PID file");
        try { await unlink(PID_FILE); } catch { /* ignore */ }
        return;
      }
      process.kill(pid, "SIGTERM");
      try { await unlink(PID_FILE); } catch { /* ignore */ }
      console.log(`Daemon stopped (PID ${pid})`);
    });

  program
    .command("evolve")
    .description("Run a single evolution cycle")
    .option("--single", "Force single-agent mode")
    .action(async (opts: { single?: boolean }) => {
      const config = await loadConfig();
      const mode = opts.single ? "single" : config.evolutionMode;
      console.log(`Starting evolution cycle (${mode} mode)...`);

      // Show progress from all job types
      executor.on("job_progress", (data: { jobType?: string; text?: string }) => {
        if (data.text) {
          const prefix = data.jobType && data.jobType.startsWith("evo-")
            ? `[${data.jobType.replace("evo-", "")}] `
            : "";
          process.stdout.write(prefix + data.text);
        }
      });

      // Backward compat for single mode
      executor.on("cycle_progress", (text: string) => {
        if (mode === "single") {
          process.stdout.write(text);
        }
      });

      try {
        if (opts.single) {
          // Temporarily override config for this run
          const origMode = config.evolutionMode;
          config.evolutionMode = "single";
          const { saveConfig } = await import("./config.js");
          await saveConfig(config);
          try {
            const result = await runEvolutionCycle();
            console.log(`\n\nEvolution cycle completed in ${Math.round(result.duration / 1000)}s`);
          } finally {
            config.evolutionMode = origMode;
            const { saveConfig: sc } = await import("./config.js");
            await sc(config);
          }
        } else {
          const result = await runEvolutionCycle();
          console.log(`\n\nEvolution cycle completed in ${Math.round(result.duration / 1000)}s`);
        }
      } catch (err) {
        console.error("Evolution cycle failed:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  program
    .command("dashboard")
    .description("Open the web dashboard in browser")
    .action(async () => {
      const config = await loadConfig();
      const url = `http://localhost:${config.port}`;
      exec(`open ${url}`, (err) => {
        if (err) {
          console.log(`Open the dashboard manually: ${url}`);
        } else {
          console.log(`Opening ${url}`);
        }
      });
    });

  program
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const pid = await readPid();
      if (pid && isProcessRunning(pid)) {
        console.log(`Daemon: running (PID ${pid})`);
      } else {
        console.log("Daemon: not running");
        if (pid) {
          try { await unlink(PID_FILE); } catch { /* ignore */ }
        }
      }
      const config = await loadConfig();
      console.log(`Interval: ${config.interval}`);
      console.log(`Model: ${config.model}`);
      console.log(`Auto-run: ${config.autoRun}`);
      if (executor.lastRun) {
        console.log(`Last run: ${executor.lastRun.toISOString()}`);
        console.log(`Last result: ${executor.lastResult?.success ? "success" : "failed"}`);
      } else {
        console.log("Last run: never");
      }
    });

  const configCmd = program
    .command("config")
    .description("Manage configuration");

  configCmd
    .command("get [key]")
    .description("Show configuration")
    .action(async (key?: string) => {
      const config = await loadConfig();
      if (key) {
        if (key in config) {
          console.log((config as unknown as Record<string, unknown>)[key]);
        } else {
          console.error(`Unknown config key: ${key}`);
          process.exit(1);
        }
      } else {
        for (const [k, v] of Object.entries(config)) {
          console.log(`${k}: ${v}`);
        }
      }
    });

  configCmd
    .command("set <key> <value>")
    .description("Update a configuration value")
    .action(async (key: string, value: string) => {
      const config = await loadConfig();
      if (!(key in config)) {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
      const typedConfig = config as unknown as Record<string, unknown>;
      // Coerce types
      if (typeof typedConfig[key] === "number") {
        typedConfig[key] = parseInt(value, 10);
      } else if (typeof typedConfig[key] === "boolean") {
        typedConfig[key] = value === "true";
      } else {
        typedConfig[key] = value;
      }
      await saveConfig(config);
      console.log(`${key}: ${typedConfig[key]}`);
    });

  // ---------------------------------------------------------------------------
  // Task subcommands
  // ---------------------------------------------------------------------------

  const taskCmd = program
    .command("task")
    .description("Manage tasks");

  taskCmd
    .command("list")
    .description("List tasks")
    .option("-s, --status <status>", "Filter by status")
    .action(async (opts: { status?: string }) => {
      const { listTasks } = await import("./task-store.js");
      let tasks = await listTasks();
      if (opts.status) {
        tasks = tasks.filter((t) => t.status === opts.status);
      }
      if (tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }
      for (const t of tasks) {
        const statusIcon = t.status === "active" ? "●" : t.status === "paused" ? "○" : t.status === "pending" ? "◌" : t.status === "expired" ? "✗" : "✓";
        const schedType = t.schedule?.type ?? "none";
        console.log(`  ${statusIcon} [${t.id}] ${t.name} (${schedType}, ${t.status})`);
      }
    });

  taskCmd
    .command("create")
    .description("Create a new task interactively")
    .action(async () => {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

      try {
        const name = await ask("Task name: ");
        const description = await ask("Description (optional): ");
        const type = (await ask("Type (recurring/one-shot) [recurring]: ")) || "recurring";
        let schedule: string | undefined;
        let scheduled_at: string | undefined;
        if (type === "recurring") {
          schedule = (await ask("Cron schedule [0 8 * * *]: ")) || "0 8 * * *";
        } else {
          const at = await ask("Scheduled at (ISO datetime, optional): ");
          if (at) scheduled_at = new Date(at).toISOString();
        }
        const prompt = await ask("Prompt: ");
        const model = await ask("Model (optional, e.g. sonnet/opus/haiku): ");
        const tagsRaw = await ask("Tags (comma-separated, optional): ");

        const { createTask } = await import("./task-store.js");
        const taskSchedule = type === "recurring" && schedule
          ? { type: "cron" as const, cron: schedule }
          : scheduled_at
            ? { type: "one-shot" as const, at: scheduled_at }
            : undefined;
        const now = new Date();
        const tsId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
        const hex = Math.random().toString(16).slice(2, 5);
        const taskId = `t_${tsId}_${hex}`;
        await createTask({
          id: taskId,
          name, description,
          schedule: taskSchedule,
          prompt,
          model: model || undefined,
          status: "active",
          approved: true,
          tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
          runCount: 0,
          createdAt: now.toISOString(),
        });
        console.log(`Task created: ${taskId}`);
      } finally {
        rl.close();
      }
    });

  taskCmd
    .command("run <id>")
    .description("Run a task immediately")
    .action(async (id: string) => {
      const { getTask, getArtifactsDir } = await import("./task-store.js");
      const { buildTaskPrompt } = await import("./prompt.js");
      const { mkdir: mkdirAsync } = await import("node:fs/promises");
      const task = await getTask(id);
      if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
      const config = await loadConfig();
      const artifactsDir = getArtifactsDir(id);
      await mkdirAsync(artifactsDir, { recursive: true });
      const reportsDir = join(homedir(), ".skill-evolver", "tasks", id, "reports");
      await mkdirAsync(reportsDir, { recursive: true });
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      const reportPath = join(reportsDir, `${ts}_report.md`);
      const prompt = buildTaskPrompt(task, artifactsDir, reportPath);

      console.log(`Running task: ${task.name}...`);
      executor.on("job_progress", (data: { taskId?: string; text?: string }) => {
        if (data.taskId === id && data.text) {
          process.stdout.write(data.text);
        }
      });

      const job = {
        id: `task-${id}-${Date.now()}`,
        type: "task" as const,
        prompt,
        model: task.model || config.model,
        taskId: id,
        taskName: task.name,
      };

      try {
        const result = await executor.run(job);
        console.log(`\nTask completed in ${Math.round(result.duration / 1000)}s`);
      } catch (err) {
        console.error("Task failed:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  taskCmd
    .command("pause <id>")
    .description("Pause a task")
    .action(async (id: string) => {
      const { updateTask } = await import("./task-store.js");
      await updateTask(id, { status: "paused" });
      console.log(`Task ${id} paused.`);
    });

  taskCmd
    .command("resume <id>")
    .description("Resume a paused task")
    .action(async (id: string) => {
      const { updateTask } = await import("./task-store.js");
      await updateTask(id, { status: "active" });
      console.log(`Task ${id} resumed.`);
    });

  taskCmd
    .command("delete <id>")
    .description("Delete a task")
    .action(async (id: string) => {
      const { deleteTask } = await import("./task-store.js");
      await deleteTask(id);
      console.log(`Task ${id} deleted.`);
    });

  taskCmd
    .command("approve <id>")
    .description("Approve a pending task")
    .action(async (id: string) => {
      const { updateTask } = await import("./task-store.js");
      await updateTask(id, { status: "active", approved: true });
      console.log(`Task ${id} approved.`);
    });

  taskCmd
    .command("reject <id>")
    .description("Reject a pending task")
    .action(async (id: string) => {
      const { getTask, updateTask, addRejected } = await import("./task-store.js");
      const task = await getTask(id);
      if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
      await addRejected({
        idea: task.name,
        reason: "Rejected by user via CLI",
        date: new Date().toISOString(),
      });
      await updateTask(id, { status: "expired" });
      console.log(`Task ${id} rejected.`);
    });

  program.parseAsync();
}
