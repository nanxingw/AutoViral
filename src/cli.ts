import { Command } from "commander";
import { loadConfig, saveConfig, type Config } from "./config.js";
import { orchestrator } from "./orchestrator.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";

const PID_FILE = join(homedir(), ".skill-evolver", "daemon.pid");

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
    .action(async () => {
      const existingPid = await readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Daemon already running (PID ${existingPid})`);
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
      await startServer(config.port);
      console.log(`Dashboard: http://localhost:${config.port}`);

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
    .action(async () => {
      console.log("Starting evolution cycle...");
      orchestrator.on("cycle_progress", (text: string) => {
        process.stdout.write(text);
      });
      try {
        const result = await orchestrator.runEvolutionCycle();
        console.log(`\n\nEvolution cycle completed in ${Math.round(result.duration / 1000)}s`);
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
      if (orchestrator.lastRun) {
        console.log(`Last run: ${orchestrator.lastRun.toISOString()}`);
        console.log(`Last result: ${orchestrator.lastResult?.success ? "success" : "failed"}`);
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

  program.parse();
}
