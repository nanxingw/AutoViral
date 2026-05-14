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
import { loadConfig, dataDir } from "../config.js";
import { initProviders } from "../providers/registry.js";
import { ensureSharedDirs } from "../shared-assets.js";
import { apiRoutes, setWsBridge, setRenderQueue } from "./api.js";
import { WsBridge } from "../ws-bridge.js";
import { attachTerminalWebSocket } from "./terminal/terminal-ws.js";
import { startAnalyticsCollector } from "../analytics-collector.js";
import { RenderQueue, defaultDbPath } from "./render-queue/index.js";
import { RenderWsRouter } from "./render-ws.js";
import { runRenderPipeline } from "./render-pipeline.js";
import { CompositionSchema } from "../shared/composition.js";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve web/dist relative to the package root (two levels up from dist/server/)
const WEB_DIST = join(__dirname, "..", "..", "web", "dist");

export async function startServer(port: number): Promise<{ server: Server }> {
  // Expose the bound port so render-pipeline can rewrite relative asset
  // URLs into HTTP URLs the Remotion renderer can fetch.
  process.env.AUTOVIRAL_PORT = String(port);

  // 1. Load config
  const config = await loadConfig();

  // 2. Initialize providers
  await initProviders(config);

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

  // 4.5. Create RenderQueue + render-ws router (Phase 7.B).
  const renderQueue = new RenderQueue({
    dbPath: process.env.AUTOVIRAL_RENDER_DB ?? defaultDbPath(),
    runRenderPipeline,
    loadComposition: async (workId: string) => {
      const raw = await readFile(
        join(dataDir, "works", workId, "composition.yaml"),
        "utf-8",
      );
      const parsed = CompositionSchema.safeParse(yaml.load(raw));
      if (!parsed.success) {
        throw new Error(`composition invalid: ${parsed.error.message}`);
      }
      return parsed.data;
    },
    outDirFor: (workId: string) => join(dataDir, "works", workId, "output"),
    concurrency: Number.parseInt(
      process.env.AUTOVIRAL_RENDER_CONCURRENCY ?? "1",
      10,
    ),
  });
  setRenderQueue(renderQueue);
  const renderWs = new RenderWsRouter(renderQueue);

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

  // Terminal WS adapter — attached without auto-binding so we can multiplex
  // through the single upgrade handler below.
  const terminalWs = attachTerminalWebSocket(null, port);

  // Route HTTP upgrade events.
  // Render-ws goes FIRST so it gets first dibs on /ws/render/jobs/:id; the
  // wsBridge handles /ws/browser/:workId; terminalWs handles /ws/terminal/:workId;
  // everything else is rejected.
  httpServer.on("upgrade", (req, socket, head) => {
    if (renderWs.handleUpgrade(req, socket, head)) return;
    if (wsBridge.handleUpgrade(req, socket, head)) return;
    if (terminalWs.handleUpgrade(req, socket, head)) return;
    // Unknown upgrade — destroy socket
    socket.destroy();
  });

  // 7. Start background services
  await startAnalyticsCollector();

  return { server: httpServer };
}
