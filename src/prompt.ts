import { getReportsDir } from "./reports.js";
import { join } from "node:path";
import type { Task } from "./task-store.js";

function currentTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}_${hh}-${mm}`;
}

export function buildPrompt(recentReports: string[], opts?: { taskAutoApprove?: boolean }): string {
  const reportPath = join(getReportsDir(), `${currentTimestamp()}_report.md`);

  const identity = `You are running as a background evolution engine for skill-evolver.
Your purpose is to use the user-context and skill-evolver skills to review session logs, accumulate insights, and evolve skills.
You have bypassPermissions — you can read and write any file needed.

CRITICAL PATH CONSTRAINT: You must ONLY read and write skill files under ~/.claude/skills/ (the installed location). NEVER modify files inside any project source directory (e.g. any path containing /skill-evolver/skills/ or similar project paths). The project's skills/ directory contains source templates and must not be touched.`;

  let reportsSection = "";
  if (recentReports.length > 0) {
    reportsSection = `\n## Recent Evolution Reports\nHere are the last ${recentReports.length} completion reports for continuity:\n\n`;
    recentReports.forEach((report, i) => {
      reportsSection += `### Report ${i + 1}\n${report}\n\n`;
    });
  } else {
    reportsSection = `\n## Recent Evolution Reports\nNo previous reports found. This is the first evolution cycle.\n`;
  }

  const task = `
## Your Task

1. **Browse session logs** — Scan recent Claude Code session logs at \`~/.claude/projects/\` (JSONL files). Focus on sessions you haven't analyzed yet (check your previous reports for reference). Each JSONL line has type, message.content, sessionId, timestamp, cwd fields.

2. **Use user-context skill** — Extract user preferences, objectives, and cognitive patterns from session logs. Update tmp YAML files with new signals. Graduate entries from tmp to context when Claude's graduation guidelines are met.

3. **Use skill-evolver skill** — Accumulate success/failure experiences and useful tips. When you identify recurring patterns with broad applicability, create new standalone skills or update existing ones you have permission to modify (check permitted_skills.md).

4. **Write completion report** — Write a brief markdown report summarizing what you did in this cycle to:
   \`${reportPath}\`
   Include: sessions analyzed, signals extracted, any graduations or skill changes made, and notes for next cycle.

5. **Task Planning** — Read the task-planner skill at \`~/.claude/skills/task-planner/\`.
   - Read buffer/ideas.yaml, existing tasks at \`~/.skill-evolver/tasks/tasks.yaml\`, and _rejected.yaml
   - Freely add/remove ideas, create tasks if appropriate
   - One-shot tasks should be scheduled before next cycle
   - Record decisions in the evolution report
   - **Task auto-approve is ${opts?.taskAutoApprove !== false ? "ON" : "OFF"}**. ${opts?.taskAutoApprove !== false ? "Set agent-created tasks to `status: active` and `approved: true` — they will run immediately on schedule." : "Set agent-created tasks to `status: pending` and `approved: false` — user must approve via dashboard."}`;

  return identity + reportsSection + task;
}

// ── Task execution prompt ────────────────────────────────────────────────────

export function buildTaskPrompt(task: Task, artifactsDir: string, reportPath: string): string {
  const identity = `You are running as a background task executor for skill-evolver.
You have bypassPermissions — you can read and write any file needed.

CRITICAL SAFETY RULES:
- NEVER modify user source files directly.
- Use git branches for any code changes.
- All persistent artifacts should be written to the artifacts directory below.
- Write your task report to the specified report path when done.`;

  const taskSection = `
## Task Details

- **Name**: ${task.name}
- **Description**: ${task.description ?? "(no description)"}
- **Task ID**: ${task.id}

## Prompt

${task.prompt}

## Artifacts Directory

Write any persistent artifacts (files, data, intermediate results) to:
\`${artifactsDir}\`

This directory is shared across runs of this task and may contain artifacts from previous runs.

## Report

When you finish, write a brief markdown report summarizing what you accomplished to:
\`${reportPath}\`

Include: what was done, any issues encountered, and suggestions for the next run (if recurring).`;

  return identity + taskSection;
}

// ── Post-task review prompt ──────────────────────────────────────────────────

export function buildPostTaskPrompt(task: Task, taskReport: string, recentReports: string[]): string {
  const reportPath = join(getReportsDir(), `${currentTimestamp()}_post-task_report.md`);

  const identity = `You are running as a post-task review cycle for skill-evolver.
Your purpose is to review the output of a recently completed task, extract lessons, and update the skill-evolver knowledge base.
You have bypassPermissions — you can read and write any file needed.

CRITICAL PATH CONSTRAINT: You must ONLY read and write skill files under ~/.claude/skills/ (the installed location). NEVER modify files inside any project source directory.`;

  let reportsSection = "";
  if (recentReports.length > 0) {
    reportsSection = `\n## Recent Evolution Reports (for context)\nHere are the last ${recentReports.length} reports:\n\n`;
    recentReports.forEach((report, i) => {
      reportsSection += `### Report ${i + 1}\n${report}\n\n`;
    });
  }

  const taskSection = `
## Completed Task

- **Name**: ${task.name}
- **Task ID**: ${task.id}
- **Description**: ${task.description ?? "(no description)"}

## Task Report Content

${taskReport}

## Your Review Task

1. **Review quality** — Assess whether the task was completed successfully. Note any issues or areas for improvement.

2. **Update skill-evolver experience** — Based on the task outcome:
   - Add success experiences to \`~/.claude/skills/skill-evolver/tmp/success_experience.yaml\` if the task demonstrated effective approaches.
   - Add failure experiences to \`~/.claude/skills/skill-evolver/tmp/failure_experience.yaml\` if something went wrong.
   - Add useful tips to \`~/.claude/skills/skill-evolver/tmp/useful_tips.yaml\` for any non-obvious learnings.

3. **Check if follow-up needed** — Determine if the task result warrants any follow-up actions (e.g., a new task, an update to user-context, a skill modification).

4. **Update idea buffer** — If the task outcome suggests new ideas for tasks or skills, add them to the idea buffer.

5. **Write review report** — Write a brief markdown report to:
   \`${reportPath}\`
   Include: quality assessment, lessons extracted, and any follow-up recommendations.`;

  return identity + reportsSection + taskSection;
}
