import { Hono } from "hono";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { executor, runEvolutionCycle } from "../executor.js";
import { isSchedulerRunning, getNextRun, reschedule } from "../scheduler.js";
import { listReports, readReport } from "../reports.js";
import { loadConfig, saveConfig, type Config } from "../config.js";
import {
  listTasks, getTask, createTask as storeCreateTask, updateTask as storeUpdateTask,
  deleteTask as storeDeleteTask, listRuns, readRun, listArtifacts, readArtifact,
  getArtifactsDir, addRejected, listIdeas, listSkillNeeds, countActiveTasks,
} from "../task-store.js";
import { buildTaskPrompt } from "../prompt.js";

export const apiRoutes = new Hono();

// ── Helper: compute a report path for a task run ────────────────────────────
function taskReportDir(taskId: string): string {
  return join(homedir(), ".skill-evolver", "tasks", taskId, "reports");
}

function currentTs(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
}

// GET /api/status
apiRoutes.get("/api/status", async (c) => {
  const nextRun = getNextRun();
  const config = await loadConfig();
  const activeAgents = Array.from(executor.running.values())
    .filter(j => j.type === "evo-context" || j.type === "evo-skill" || j.type === "evo-task" || j.type === "evolution")
    .map(j => ({ id: j.id, type: j.type }));
  return c.json({
    state: executor.state,
    lastRun: executor.lastRun?.toISOString() ?? null,
    nextRun: nextRun?.toISOString() ?? null,
    isSchedulerActive: isSchedulerRunning(),
    evolutionMode: config.evolutionMode,
    activeAgents,
  });
});

// POST /api/trigger
apiRoutes.post("/api/trigger", (c) => {
  runEvolutionCycle().catch(() => {
    // errors emitted via executor events
  }).finally(() => {
    reschedule();
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
    home, ".claude", "skills", "skill-evolver", "reference", "permitted_skills.md",
  );
  const skillsBase = join(home, ".claude", "skills");

  try {
    const raw = await readFile(permittedPath, "utf-8");
    const skillNames = raw
      .split("\n")
      .filter((line) => /^[-*]\s+\S/.test(line))
      .map((line) => {
        const stripped = line.replace(/^[-*]\s*/, "").trim();
        // Handle formats: "**name** — desc", "**name**", "name — desc", "name"
        const boldMatch = stripped.match(/^\*\*([^*]+)\*\*/);
        if (boldMatch) return boldMatch[1].trim();
        // Plain name before any separator
        const dashMatch = stripped.match(/^([^—–\-]+)/);
        if (dashMatch) return dashMatch[1].trim();
        return stripped;
      })
      .filter((name) => name.length > 0 && !name.startsWith("("));

    const skills = await Promise.all(
      skillNames.map(async (name) => {
        const skillMdPath = join(skillsBase, name, "SKILL.md");
        let exists = false;
        let description = "";
        let summary = "";
        try {
          const content = await readFile(skillMdPath, "utf-8");
          exists = true;
          // Extract description from YAML frontmatter
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const descMatch = fmMatch[1].match(/description:\s*(.+)/);
            if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
          }
          // Extract first meaningful paragraph as summary (skip frontmatter and headings)
          const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
          const lines = body.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---") && !trimmed.startsWith("```")) {
              summary = trimmed.length > 150 ? trimmed.slice(0, 150) + "..." : trimmed;
              break;
            }
          }
        } catch {
          exists = false;
        }
        const path = join(skillsBase, name);
        return { name, exists, description, summary, path };
      }),
    );

    return c.json({ skills });
  } catch {
    return c.json({ skills: [] });
  }
});

// POST /api/skills/:name/open — open skill directory in Finder
apiRoutes.post("/api/skills/:name/open", async (c) => {
  const name = c.req.param("name");
  const dir = join(homedir(), ".claude", "skills", name);
  try {
    const { spawn } = await import("node:child_process");
    spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
    return c.json({ opened: true });
  } catch {
    return c.json({ error: "Failed to open directory" }, 500);
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

// ---------------------------------------------------------------------------
// Task API
// ---------------------------------------------------------------------------

// GET /api/tasks
apiRoutes.get("/api/tasks", async (c) => {
  const status = c.req.query("status");
  try {
    let tasks = await listTasks();
    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }
    return c.json({ tasks });
  } catch {
    return c.json({ tasks: [] });
  }
});

// GET /api/tasks/:id
apiRoutes.get("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const task = await getTask(id);
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// POST /api/tasks
apiRoutes.post("/api/tasks", async (c) => {
  try {
    // Enforce active task limit
    const config = await loadConfig();
    const activeCount = await countActiveTasks();
    if (activeCount >= config.taskMaxActive) {
      return c.json({
        error: `Active task limit reached (${activeCount}/${config.taskMaxActive}). Complete, pause, or delete existing tasks first.`,
      }, 409);
    }

    const body = await c.req.json();
    // Generate ID and fill defaults
    const now = new Date();
    const tsId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const hex = Math.random().toString(16).slice(2, 5);
    const id = body.id || `t_${tsId}_${hex}`;

    // Build schedule object from frontend fields
    let schedule = body.schedule;
    if (typeof schedule === "string") {
      schedule = { type: "cron" as const, cron: schedule };
    }
    if (!schedule && body.scheduled_at) {
      schedule = { type: "one-shot" as const, at: body.scheduled_at };
    }

    const priority = body.priority;
    if (priority && !["high", "normal", "low"].includes(priority)) {
      return c.json({ error: "Invalid priority. Must be high, normal, or low." }, 400);
    }

    const task = {
      id,
      name: body.name || "Untitled",
      description: body.description,
      prompt: body.prompt || "",
      schedule,
      status: body.status || "active",
      approved: body.approved ?? true,
      model: body.model,
      tags: body.tags || [],
      priority: priority || "normal",
      failCount: 0,
      runCount: 0,
      createdAt: now.toISOString(),
    };

    await storeCreateTask(task);
    return c.json(task, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create task" }, 400);
  }
});

// PUT /api/tasks/:id
apiRoutes.put("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json();
    const task = await storeUpdateTask(id, body);
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// DELETE /api/tasks/:id
apiRoutes.delete("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  try {
    await storeDeleteTask(id);
    return c.json({ deleted: true });
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// POST /api/tasks/:id/approve
apiRoutes.post("/api/tasks/:id/approve", async (c) => {
  const id = c.req.param("id");
  try {
    const task = await storeUpdateTask(id, { status: "active", approved: true });
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// POST /api/tasks/:id/reject
apiRoutes.post("/api/tasks/:id/reject", async (c) => {
  const id = c.req.param("id");
  try {
    const task = await getTask(id);
    if (!task) return c.json({ error: "Task not found" }, 404);
    await addRejected({
      idea: task.name,
      reason: "Rejected by user via dashboard",
      date: new Date().toISOString(),
    });
    await storeUpdateTask(id, { status: "expired" });
    return c.json({ rejected: true });
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// POST /api/tasks/:id/retry — reset fail count and reactivate
apiRoutes.post("/api/tasks/:id/retry", async (c) => {
  const id = c.req.param("id");
  try {
    const task = await getTask(id);
    if (!task) return c.json({ error: "Task not found" }, 404);
    const updated = await storeUpdateTask(id, {
      status: "active",
      failCount: 0,
      nextRetryAfter: undefined,
    });
    return c.json(updated);
  } catch {
    return c.json({ error: "Failed to retry task" }, 500);
  }
});

// POST /api/tasks/:id/trigger
apiRoutes.post("/api/tasks/:id/trigger", async (c) => {
  const id = c.req.param("id");
  try {
    const task = await getTask(id);
    if (!task) return c.json({ error: "Task not found" }, 404);
    const config = await loadConfig();
    const artifactsDir = getArtifactsDir(id);
    await mkdir(artifactsDir, { recursive: true });
    const reportsDir = taskReportDir(id);
    await mkdir(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${currentTs()}_report.md`);
    const prompt = buildTaskPrompt(task, artifactsDir, reportPath);
    const job = {
      id: `task-${id}-${Date.now()}`,
      type: "task" as const,
      prompt,
      model: task.model || config.model,
      taskId: id,
      taskName: task.name,
    };
    executor.run(job).catch(() => { /* errors emitted via events */ });
    return c.json({ triggered: true });
  } catch {
    return c.json({ error: "Task not found" }, 404);
  }
});

// GET /api/tasks/:id/runs
apiRoutes.get("/api/tasks/:id/runs", async (c) => {
  const id = c.req.param("id");
  try {
    const runs = await listRuns(id);
    return c.json({
      runs: runs.map((r) => ({
        filename: r.filename,
        date: r.date.toISOString(),
      })),
    });
  } catch {
    return c.json({ runs: [] });
  }
});

// GET /api/tasks/:id/runs/:filename
apiRoutes.get("/api/tasks/:id/runs/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  try {
    const content = await readRun(id, filename);
    return c.json({ filename, content });
  } catch {
    return c.json({ error: "Run not found" }, 404);
  }
});

// GET /api/tasks/:id/artifacts
apiRoutes.get("/api/tasks/:id/artifacts", async (c) => {
  const id = c.req.param("id");
  try {
    const artifacts = await listArtifacts(id);
    return c.json({ artifacts });
  } catch {
    return c.json({ artifacts: [] });
  }
});

// GET /api/tasks/:id/artifacts/:filename — read individual artifact content
apiRoutes.get("/api/tasks/:id/artifacts/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  try {
    const content = await readArtifact(id, filename);
    return c.json({ filename, content });
  } catch {
    return c.json({ error: "Artifact not found" }, 404);
  }
});

// POST /api/tasks/:id/artifacts/open
apiRoutes.post("/api/tasks/:id/artifacts/open", async (c) => {
  const id = c.req.param("id");
  try {
    const dir = getArtifactsDir(id);
    const { exec: execCb } = await import("node:child_process");
    execCb(`open "${dir}"`);
    return c.json({ opened: true });
  } catch {
    return c.json({ error: "Failed to open artifacts" }, 500);
  }
});

// GET /api/skill-needs
apiRoutes.get("/api/skill-needs", async (c) => {
  try {
    const needs = await listSkillNeeds();
    return c.json({ needs });
  } catch {
    return c.json({ needs: [] });
  }
});

// GET /api/dashboard — aggregated dashboard data
apiRoutes.get("/api/dashboard", async (c) => {
  try {
    const config = await loadConfig();
    const nextRun = getNextRun();

    // Active agents
    const activeAgents = Array.from(executor.running.values())
      .filter(j => j.type === "evo-context" || j.type === "evo-skill" || j.type === "evo-task" || j.type === "evolution")
      .map(j => ({ id: j.id, type: j.type }));

    // Recent reports (last 5) with summary
    let recentReports: { filename: string; date: string; summary: string; agentType: string }[] = [];
    try {
      const allReports = await listReports();
      allReports.sort((a, b) => b.date.getTime() - a.date.getTime());
      const top5 = allReports.slice(0, 5);
      recentReports = await Promise.all(top5.map(async (r) => {
        let summary = "";
        let agentType = "evolution";
        if (r.filename.includes("_context_")) agentType = "context";
        else if (r.filename.includes("_skill_")) agentType = "skill";
        else if (r.filename.includes("_task_")) agentType = "task";
        try {
          const content = await readReport(r.filename);
          // Extract first meaningful line as summary
          const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
          summary = (lines[0] ?? "").trim().slice(0, 120);
        } catch { /* ignore */ }
        return { filename: r.filename, date: r.date.toISOString(), summary, agentType };
      }));
    } catch { /* ignore */ }

    // Active tasks with schedules
    let scheduledTasks: { id: string; name: string; status: string; schedule?: TaskScheduleDTO; lastRun?: string; runCount: number; tags?: string[] }[] = [];
    try {
      const tasks = await listTasks();
      scheduledTasks = tasks
        .filter(t => t.status === "active" || t.status === "pending")
        .slice(0, 8)
        .map(t => ({
          id: t.id,
          name: t.name,
          status: t.status,
          schedule: t.schedule as TaskScheduleDTO | undefined,
          lastRun: t.lastRun,
          runCount: t.runCount ?? 0,
          tags: t.tags,
        }));
    } catch { /* ignore */ }

    // Skills count
    let skillCount = 0;
    try {
      const permPath = join(homedir(), ".claude", "skills", "skill-evolver", "reference", "permitted_skills.md");
      const raw = await readFile(permPath, "utf-8");
      skillCount = raw.split("\n").filter(l => /^[-*]\s+\S/.test(l)).length;
    } catch { /* ignore */ }

    // Total reports count
    let totalReports = 0;
    try {
      const allR = await listReports();
      totalReports = allR.length;
    } catch { /* ignore */ }

    return c.json({
      state: executor.state,
      lastRun: executor.lastRun?.toISOString() ?? null,
      nextRun: nextRun?.toISOString() ?? null,
      evolutionMode: config.evolutionMode,
      activeAgents,
      recentReports,
      scheduledTasks,
      skillCount,
      totalReports,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Dashboard error" }, 500);
  }
});

interface TaskScheduleDTO {
  type: "cron" | "one-shot";
  cron?: string;
  at?: string;
}

// GET /api/ideas
apiRoutes.get("/api/ideas", async (c) => {
  try {
    const ideas = await listIdeas();
    return c.json({ ideas });
  } catch {
    return c.json({ ideas: [] });
  }
});
