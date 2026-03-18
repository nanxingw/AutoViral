import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { apiRoutes, setWsBridge } from "./api.js";
import { WsBridge } from "../ws-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve web/dist relative to the package root (two levels up from dist/server/)
const WEB_DIST = join(__dirname, "..", "..", "web", "dist");

export function startServer(port: number): { server: Server } {
  const app = new Hono();

  // Mount API routes
  app.route("/", apiRoutes);

  // Serve static files from web/dist
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

  const nodeServer = serve({
    fetch: app.fetch,
    port,
  });

  const httpServer = nodeServer as unknown as Server;

  // Create WsBridge for CLI <-> browser sessions
  const wsBridge = new WsBridge(port);
  setWsBridge(wsBridge);

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

  return { server: httpServer };
}
