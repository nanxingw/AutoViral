import { getReportsDir } from "./reports.js";
import { join } from "node:path";

function currentTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}_${hh}-${mm}`;
}

export function buildPrompt(recentReports: string[]): string {
  const reportPath = join(getReportsDir(), `${currentTimestamp()}_report.md`);

  const identity = `You are running as a background evolution engine for skill-evolver.
Your purpose is to use the user-context and skill-evolver skills to review session logs, accumulate insights, and evolve skills.
You have bypassPermissions — you can read and write any file needed.`;

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
   Include: sessions analyzed, signals extracted, any graduations or skill changes made, and notes for next cycle.`;

  return identity + reportsSection + task;
}
