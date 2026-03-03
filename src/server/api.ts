import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { orchestrator } from "../orchestrator.js";
import { isSchedulerRunning, getNextRun } from "../scheduler.js";
import { listReports, readReport, getReportsDir } from "../reports.js";
import { loadConfig, saveConfig, type Config } from "../config.js";

export const apiRoutes = new Hono();

// GET /api/status
apiRoutes.get("/api/status", (c) => {
  const nextRun = getNextRun();
  return c.json({
    state: orchestrator.state,
    lastRun: orchestrator.lastRun?.toISOString() ?? null,
    nextRun: nextRun?.toISOString() ?? null,
    isSchedulerActive: isSchedulerRunning(),
  });
});

// POST /api/trigger
apiRoutes.post("/api/trigger", (c) => {
  orchestrator.runEvolutionCycle().catch(() => {
    // errors emitted via orchestrator events
  });
  return c.json({ triggered: true });
});

// GET /api/reports
apiRoutes.get("/api/reports", async (c) => {
  try {
    const reports = await listReports();
    return c.json({
      reports: reports.map((r) => ({
        filename: r.filename,
        date: r.date.toISOString(),
      })),
    });
  } catch {
    return c.json({ reports: [] });
  }
});

// GET /api/reports/:filename
apiRoutes.get("/api/reports/:filename", async (c) => {
  const filename = c.req.param("filename");
  try {
    const content = await readReport(filename);
    return c.json({ filename, content });
  } catch {
    return c.json({ error: "Report not found" }, 404);
  }
});

// GET /api/context/:pillar
apiRoutes.get("/api/context/:pillar", async (c) => {
  const pillar = c.req.param("pillar");
  const home = homedir();
  const userContextBase = join(home, ".claude", "skills", "user-context");
  const skillEvolverBase = join(home, ".claude", "skills", "skill-evolver");

  const pillarMap: Record<string, { context?: string; tmp?: string }> = {
    preference: {
      context: join(userContextBase, "context", "preference.yaml"),
      tmp: join(userContextBase, "tmp", "preference_tmp.yaml"),
    },
    objective: {
      context: join(userContextBase, "context", "objective.yaml"),
      tmp: join(userContextBase, "tmp", "objective_tmp.yaml"),
    },
    cognition: {
      context: join(userContextBase, "context", "cognition.yaml"),
      tmp: join(userContextBase, "tmp", "cognition_tmp.yaml"),
    },
    success_experience: {
      tmp: join(skillEvolverBase, "tmp", "success_experience.yaml"),
    },
    failure_experience: {
      tmp: join(skillEvolverBase, "tmp", "failure_experience.yaml"),
    },
    useful_tips: {
      tmp: join(skillEvolverBase, "tmp", "useful_tips.yaml"),
    },
  };

  const paths = pillarMap[pillar];
  if (!paths) {
    return c.json({ error: "Unknown pillar" }, 404);
  }

  async function loadYaml(filePath: string): Promise<unknown[]> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = yaml.load(raw) as { entries?: unknown[] } | null;
      return parsed?.entries ?? [];
    } catch {
      return [];
    }
  }

  const context = paths.context ? await loadYaml(paths.context) : [];
  const tmp = paths.tmp ? await loadYaml(paths.tmp) : [];

  return c.json({ context, tmp });
});

// GET /api/skills
apiRoutes.get("/api/skills", async (c) => {
  const home = homedir();
  const permittedPath = join(
    home,
    ".claude",
    "skills",
    "skill-evolver",
    "reference",
    "permitted_skills.md",
  );
  const skillsBase = join(home, ".claude", "skills");

  try {
    const raw = await readFile(permittedPath, "utf-8");
    const skillNames = raw
      .split("\n")
      .filter((line) => /^[-*]\s+\S/.test(line))
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((name) => name.length > 0 && !name.startsWith("("));

    const skills = await Promise.all(
      skillNames.map(async (name) => {
        const skillMdPath = join(skillsBase, name, "SKILL.md");
        let exists = false;
        try {
          await readFile(skillMdPath, "utf-8");
          exists = true;
        } catch {
          exists = false;
        }
        return { name, exists };
      }),
    );

    return c.json({ skills });
  } catch {
    return c.json({ skills: [] });
  }
});

// GET /api/config
apiRoutes.get("/api/config", async (c) => {
  const config = await loadConfig();
  return c.json(config);
});

// PUT /api/config
apiRoutes.put("/api/config", async (c) => {
  const body = await c.req.json<Partial<Config>>();
  const current = await loadConfig();
  const updated: Config = { ...current, ...body };
  await saveConfig(updated);
  return c.json(updated);
});
