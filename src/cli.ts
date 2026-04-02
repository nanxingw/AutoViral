import { Command } from "commander";
import { loadConfig, saveConfig, type Config, getConfigDir } from "./config.js";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec, spawn } from "node:child_process";

const PID_FILE = join(homedir(), ".autoviral", "daemon.pid");
const LOG_FILE = join(homedir(), ".autoviral", "daemon.log");

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
    .name("autocode")
    .description("AutoViral — AI-powered content creation")
    .version("0.2.0");

  program
    .command("start")
    .description("Start the AutoViral server")
    .option("--foreground", "Run in foreground (don't daemonize)")
    .option("--pm2", "Start with pm2 process manager (auto-restart on crash)")
    .action(async (opts: { foreground?: boolean; pm2?: boolean }) => {
      const existingPid = await readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Server already running (PID ${existingPid})`);
        console.log(`Run 'autocode stop' first, then start again.`);
        return;
      }

      // pm2 mode: delegate to pm2
      if (opts.pm2) {
        try {
          const { execSync: execSyncPm2 } = await import("node:child_process");
          execSyncPm2("pm2 --version", { stdio: "ignore" });
          const configPath = join(process.cwd(), "ecosystem.config.cjs");
          execSyncPm2(`pm2 start ${configPath}`, { stdio: "inherit" });
          console.log("AutoViral started with pm2 (auto-restart enabled)");
          console.log("Use 'pm2 logs autoviral' to view logs");
          console.log("Use 'pm2 stop autoviral' to stop");
          return;
        } catch {
          console.error("pm2 not found. Install with: npm install -g pm2");
          console.log("Falling back to normal start...");
        }
      }

      // If not --foreground and not already a spawned daemon, fork to background
      if (!opts.foreground && !process.env.__AUTOVIRAL_DAEMON) {
        await mkdir(getConfigDir(), { recursive: true });
        const fs = await import("node:fs");
        const logFd = fs.openSync(LOG_FILE, "a");
        const entryScript = process.argv[1];
        // If running under tsx (or ts file), use npx tsx to fork; otherwise use node directly
        const isTsEntry = entryScript.endsWith(".ts");
        const forkCmd = isTsEntry ? "npx" : process.execPath;
        const forkArgs = isTsEntry
          ? ["tsx", entryScript, "start", "--foreground"]
          : [entryScript, "start", "--foreground"];
        const child = spawn(forkCmd, forkArgs, {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, __AUTOVIRAL_DAEMON: "1" },
        });
        child.unref();
        fs.closeSync(logFd);
        // Wait briefly for PID file to be written
        await new Promise(r => setTimeout(r, 1500));
        const pid = await readPid();
        const config = await loadConfig();
        console.log(`AutoViral server started (PID ${pid ?? child.pid})`);
        console.log(`Dashboard: http://localhost:${config.port}`);
        console.log(`Logs: ${LOG_FILE}`);
        return;
      }

      // Global error handlers — prevent process from crashing on unhandled errors
      process.on("uncaughtException", (err) => {
        console.error("[FATAL] Uncaught exception (process kept alive):", err);
      });
      process.on("unhandledRejection", (reason) => {
        console.error("[FATAL] Unhandled rejection (process kept alive):", reason);
      });

      const config = await loadConfig();
      await writeFile(PID_FILE, String(process.pid), "utf-8");

      console.log(`Starting AutoViral server (PID ${process.pid})`);
      console.log(`Model: ${config.model}`);

      // Start web server (initializes providers, shared dirs, etc.)
      const { startServer } = await import("./server/index.js");
      await startServer(config.port);
      console.log(`Dashboard: http://localhost:${config.port}`);

      // Keep process alive
      process.on("SIGTERM", async () => {
        console.log("\nShutting down...");

        try { await unlink(PID_FILE); } catch { /* ignore */ }
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        console.log("\nShutting down...");

        try { await unlink(PID_FILE); } catch { /* ignore */ }
        process.exit(0);
      });
    });

  program
    .command("stop")
    .description("Stop the AutoViral server")
    .action(async () => {
      const pid = await readPid();
      if (!pid) {
        console.log("No daemon PID file found");
        return;
      }
      if (!isProcessRunning(pid)) {
        console.log("Server not running, cleaning up PID file");
        try { await unlink(PID_FILE); } catch { /* ignore */ }
        return;
      }
      process.kill(pid, "SIGTERM");
      try { await unlink(PID_FILE); } catch { /* ignore */ }
      console.log(`Server stopped (PID ${pid})`);
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

  program.parseAsync();
}
