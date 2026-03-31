import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Server } from "node:http";
import { loadConfig } from "../config.js";
import { initProviders } from "../providers/registry.js";
import { ensureSharedDirs } from "../shared-assets.js";
import { apiRoutes, setWsBridge } from "./api.js";
import { WsBridge } from "../ws-bridge.js";
import { startResearchScheduler } from "../research-scheduler.js";
import { startAnalyticsCollector } from "../analytics-collector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve web/dist relative to the package root (two levels up from dist/server/)
const WEB_DIST = join(__dirname, "..", "..", "web", "dist");

export async function startServer(port: number): Promise<{ server: Server }> {
  // 1. Load config
  const config = await loadConfig();

  // 2. Initialize providers
  initProviders(config);

  // 3. Ensure shared asset directories
  await ensureSharedDirs();

  // 3.5. Sync skills to ~/.claude/skills/ (agent reads from there)
  const projectSkills = join(process.cwd(), "skills");
  const installedSkills = join(homedir(), ".claude", "skills");
  if (existsSync(projectSkills)) {
    try {
      execSync(`rsync -a --delete "${projectSkills}/" "${installedSkills}/"`, { stdio: "ignore" });
      console.log("Skills synced to ~/.claude/skills/");
    } catch {
      console.warn("Warning: failed to sync skills to ~/.claude/skills/");
    }
  }

  // 4. Create WsBridge
  const wsBridge = new WsBridge(port);
  setWsBridge(wsBridge);

  const app = new Hono();

  // 5. Mount API routes
  app.route("/", apiRoutes);

  // 8. Serve static frontend files from web/dist/
  app.use("/*", serveStatic({ root: WEB_DIST }));

  // SPA fallback: serve index.html for any non-API GET request that didn't match a static file
  app.get("*", async (c) => {
    try {
      const indexPath = join(WEB_DIST, "index.html");
      const html = await readFile(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("Dashboard not built. Run: npm run build:frontend", 404);
    }
  });

  // 6. Start HTTP server + WebSocket upgrade handler
  const nodeServer = serve({
    fetch: app.fetch,
    port,
  });

  const httpServer = nodeServer as unknown as Server;

  // Route HTTP upgrade events
  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";

    // Try WsBridge first (handles /ws/browser/:workId)
    if (wsBridge.handleUpgrade(req, socket, head)) {
      return;
    }

    // Unknown upgrade — destroy socket
    socket.destroy();
  });

  // 7. Start research scheduler
  await startResearchScheduler();
  await startAnalyticsCollector();

  return { server: httpServer };
}
