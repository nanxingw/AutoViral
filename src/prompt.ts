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

// ── Shared fragments ────────────────────────────────────────────────────────

const CRITICAL_PATH = `CRITICAL PATH CONSTRAINT: You must ONLY read and write skill files under ~/.claude/skills/ (the installed location). NEVER modify files inside any project source directory (e.g. any path containing /skill-evolver/skills/ or similar project paths). The project's skills/ directory contains source templates and must not be touched.`;

const SCRIPTS_REFERENCE = `## Session Search Scripts

Search scripts are installed at \`~/.claude/skills/user-context/scripts/\`. Use them via Bash to efficiently query session history — **prefer scripts over reading raw JSONL files** (they can be 200MB+ and 99% is noise).

| Script | Purpose | Example |
|--------|---------|---------|
| \`list-sessions.mjs\` | Find sessions by date/project | \`node ~/.claude/skills/user-context/scripts/list-sessions.mjs --since 2026-03-04 --limit 10\` |
| \`session-stats.mjs\` | Quick stats for a session | \`node ~/.claude/skills/user-context/scripts/session-stats.mjs --file <path>\` |
| \`session-digest.mjs\` | Extract conversation text only | \`node ~/.claude/skills/user-context/scripts/session-digest.mjs --file <path>\` |
| \`search-messages.mjs\` | Regex keyword search across sessions | \`node ~/.claude/skills/user-context/scripts/search-messages.mjs --query "error\\|failed"\` |
| \`extract-tool-flow.mjs\` | Tool usage sequence + errors | \`node ~/.claude/skills/user-context/scripts/extract-tool-flow.mjs --file <path> --compact\` |`;

function reportsSection(recentReports: string[]): string {
  if (recentReports.length > 0) {
    let section = `\n## Recent Evolution Reports\nHere are the last ${recentReports.length} completion reports for continuity:\n\n`;
    recentReports.forEach((report, i) => {
      section += `### Report ${i + 1}\n${report}\n\n`;
    });
    return section;
  }
  return `\n## Recent Evolution Reports\nNo previous reports found. This is the first evolution cycle.\n`;
}

// ── Single-agent prompt (backward compat) ───────────────────────────────────

export function buildPrompt(recentReports: string[], opts?: { taskAutoApprove?: boolean }): string {
  const reportPath = join(getReportsDir(), `${currentTimestamp()}_report.md`);

  const identity = `You are running as a background evolution engine for skill-evolver.
Your purpose is to use the user-context and skill-evolver skills to review session logs, accumulate insights, and evolve skills.
You have bypassPermissions — you can read and write any file needed.

${CRITICAL_PATH}`;

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

  return identity + reportsSection(recentReports) + task;
}

// ── Multi-agent prompts ─────────────────────────────────────────────────────

export function buildContextAgentPrompt(recentReports: string[], reportPath: string): string {
  const identity = `You are the **Context Agent** — one of three parallel agents in a skill-evolver evolution cycle.
Your sole responsibility is maintaining the user profile: preferences, objectives, and cognition.
You have bypassPermissions — you can read and write any file needed.

${CRITICAL_PATH}

## Your Data Paths

**Write access:**
- \`~/.claude/skills/user-context/context/\` (preference.yaml, objective.yaml, cognition.yaml)
- \`~/.claude/skills/user-context/tmp/\` (preference_tmp.yaml, objective_tmp.yaml, cognition_tmp.yaml)

**Read access:**
- Session logs at \`~/.claude/projects/\`

**Do NOT touch:**
- \`~/.claude/skills/skill-evolver/\` (another agent handles this)
- \`~/.skill-evolver/tasks/\` (another agent handles this)`;

  const task = `
${SCRIPTS_REFERENCE}

## Your Workflow

1. **Read your previous reports** (provided below) to know what sessions you already processed.

2. **Find new sessions** using \`list-sessions.mjs --since <last-run-date>\`. Identify sessions you haven't analyzed yet.

3. **Extract user signals** from session logs using session-digest.mjs and search-messages.mjs. Look for:
   - **Preferences**: Tool choices, code style, workflow habits, communication patterns
   - **Objectives**: New projects, goals mentioned, recurring themes
   - **Cognition**: Decision-making style, personality traits, communication patterns

4. **ADD SIGNAL** to the appropriate tmp file. If a matching entry exists, append a new signal. If not, create a new entry.

5. **Check graduation conditions**: An entry graduates from tmp to context when it has **3+ signals spanning 2+ days** with no contradictions. When graduating:
   - Add the entry to the corresponding context file
   - Sum the signal count into \`source_signals\`
   - Remove from tmp

6. **Clean stale entries**: Remove tmp entries with \`last_seen\` 60+ days ago and only 1-2 signals.

7. **Write report** to:
   \`${reportPath}\`
   Include: sessions scanned, signals added, graduations, notes for next cycle. Use this format:

\`\`\`markdown
# Context Agent Report — {date}

## Sessions Analyzed
(list sessions with IDs and summaries)

## Signals Added
- preference: N new signals
- objective: N new signals
- cognition: N new signals

## Graduations
(list any entries graduated from tmp to context)

## Stale Entries Cleaned
(list any removed)

## Notes
(observations for next cycle)
\`\`\``;

  return identity + reportsSection(recentReports) + task;
}

export function buildSkillAgentPrompt(recentReports: string[], reportPath: string): string {
  const identity = `You are the **Skill Agent** — one of three parallel agents in a skill-evolver evolution cycle.
Your core mission is: **Discover user needs and find or create the best Claude Code skills to address them.**
You are NOT passively accumulating experience waiting for thresholds. You are actively seeking unmet needs and filling gaps.
You have bypassPermissions — you can read and write any file needed.

${CRITICAL_PATH}

## Your Data Paths

**Write access:**
- \`~/.claude/skills/skill-evolver/tmp/\` (success_experience.yaml, failure_experience.yaml, useful_tips.yaml, skill_needs.yaml)
- \`~/.claude/skills/skill-evolver/reference/permitted_skills.md\`
- \`~/.claude/skills/<new-skill-name>/\` (creating new skills)
- \`~/.claude/skills/<permitted-skill>/\` (evolving registered skills)

**Read access:**
- \`~/.claude/skills/user-context/context/\` and \`tmp/\` (user profile — read only)
- \`~/.claude/skills/skill-evolver/tmp/\` (experience base)
- \`~/.skill-evolver/tasks/tasks.yaml\` (task inventory — read only)
- \`~/.skill-evolver/tasks/*/reports/\` (task execution reports — read only)
- Session logs at \`~/.claude/projects/\`

**Do NOT touch:**
- \`~/.claude/skills/user-context/\` (another agent handles this)
- \`~/.skill-evolver/tasks/tasks.yaml\` (another agent handles this — read only!)
- \`~/.claude/skills/skill-evolver/SKILL.md\` (your own instructions)`;

  const task = `
${SCRIPTS_REFERENCE}

## Your Workflow

### Step 1: Need Discovery (MANDATORY — do not skip)

You must identify user needs from multiple sources. This is your most important step.

**Source A — User objectives**
Read \`~/.claude/skills/user-context/context/objective.yaml\`.
For each objective, ask: "What skill would help the user achieve this more effectively?"

**Source B — User preferences**
Read \`~/.claude/skills/user-context/context/preference.yaml\`.
Do any preferences imply a standardized workflow that could be captured as a skill?

**Source C — Accumulated experience**
Read all files in \`~/.claude/skills/skill-evolver/tmp/\`.
- Recurring success patterns → could crystallize into a skill
- Recurring failure patterns → could become a preventive skill
- Useful tips with 3+ signals → strong candidates for skill creation

**Source D — Session logs**
Use scripts to scan recent sessions. Look for:
- Operations the user repeatedly performs manually (automate as skill)
- Things the user repeatedly explains to Claude (should be in a skill)
- Difficulties or friction points (skill can provide pre-built solutions)

**Source E — Task execution patterns (IMPORTANT — co-evolution)**
Read \`~/.skill-evolver/tasks/tasks.yaml\` for the task inventory, then browse recent task reports in \`~/.skill-evolver/tasks/*/reports/\`. Look for:
- Tasks that failed repeatedly → a skill could prevent the failure pattern
- Tasks where the agent had to improvise or figure things out → codify that knowledge as a skill
- Tasks that always need certain boilerplate or setup → extract as a utility skill
- Multiple tasks sharing similar patterns → a common skill would help all of them

**Source F — Skill-need signals (PRIORITY)**
Read \`~/.claude/skills/skill-evolver/tmp/skill_needs.yaml\`. These are high-priority needs emitted by post-task reviews when tasks struggle or fail. Address these FIRST before other needs. After addressing a need, set its \`addressed\` field to \`true\`.

**Output**: List of identified needs (at least 3) in your report.

### Step 2: Match Against Existing Skills

List all skills in \`~/.claude/skills/\` using: \`ls ~/.claude/skills/\`
For each identified need, check if an existing skill covers it.
- If covered and working well → note it, move on
- If covered but needs improvement → mark for evolution (Step 4)
- If not covered → move to Step 3

### Step 3: Search External Skills

Before creating from scratch, search for existing skills:

1. **SkillHub**: Use WebSearch or WebFetch to search \`https://www.skillhub.club/\` for relevant skills
2. **GitHub**: Use Bash to search: \`gh search repos "claude code skill <keyword>" --limit 5\` or WebSearch for "claude code skill <keyword> site:github.com"
3. **Anthropic official**: Check \`https://github.com/anthropics/\` for official skills

If you find a suitable external skill:
- Download it to a temp directory: \`git clone <repo> /tmp/skill-download-<name>\`
- Review its SKILL.md for quality and safety
- Copy to \`~/.claude/skills/<name>/\`
- Adapt/modify to fit the user's specific needs
- Register in \`permitted_skills.md\`

If nothing suitable found → proceed to Step 4.

### Step 4: Create or Evolve Skills (using skill-creator)

You MUST use skill-creator methodology when creating or evolving skills. Read \`~/.claude/skills/skill-creator/SKILL.md\` first.

**Creating a new skill:**
1. Read \`~/.claude/skills/skill-creator/SKILL.md\` thoroughly for best practices
2. **Design the skill** following skill-creator's anatomy:
   - Write a precise \`description\` in the YAML frontmatter — this is the PRIMARY trigger mechanism. Make it "pushy" (include specific contexts and keywords that should trigger it)
   - Keep SKILL.md under 500 lines; use \`references/\` for detailed docs
   - Follow progressive disclosure: metadata → SKILL.md body → bundled resources
3. **Write basic evals** — create \`~/.claude/skills/<skill-name>/evals/evals.json\` with 2-3 realistic test prompts:
   \`\`\`json
   {
     "skill_name": "<skill-name>",
     "evals": [
       { "id": 1, "prompt": "Realistic user prompt that should trigger this skill", "expected_output": "What the skill should produce" }
     ]
   }
   \`\`\`
4. **Register** the skill name in \`~/.claude/skills/skill-evolver/reference/permitted_skills.md\`

**Evolving an existing skill:**
1. Only modify skills listed in \`permitted_skills.md\`
2. Read the skill's existing SKILL.md and any evals
3. Use Edit for targeted changes — don't rewrite entire files unless necessary
4. Base changes on accumulated experience evidence
5. If the skill has \`evals/evals.json\`, consider updating the evals to cover new scenarios

**Skill quality checklist** (from skill-creator):
- [ ] Clear, actionable instructions using imperative form
- [ ] Explains the **why** behind instructions, not just rigid rules
- [ ] Description is trigger-optimized (pushy, includes keywords and contexts)
- [ ] Under 500 lines for SKILL.md; references/ for detailed content
- [ ] Scoped to one coherent topic, no duplication with existing skills
- [ ] Valid YAML frontmatter with name and description

### Step 5: Experience Maintenance

Continue maintaining the experience base — it helps you make better decisions:
- **ADD SIGNAL**: When you find success/failure/tip patterns in session logs, add them to the appropriate tmp file
- **CLEAN STALE**: Remove entries with \`last_seen\` 60+ days ago and only 1-2 signals
- Experience data is your **decision reference**, not a graduation queue

### Step 6: Write Report

Write your report to:
\`${reportPath}\`

**MANDATORY report sections** (you must answer all of these):

\`\`\`markdown
# Skill Agent Report — {date}

## Needs Discovered
(List at least 3 identified user needs with evidence source)

1. Need: ...
   Source: objective/preference/experience/session/task-execution/skill-need-signal
   Evidence: ...

## Existing Skill Coverage
(For each need, which existing skills cover it? Any gaps?)

## External Skill Search
(What did you search for? What did you find? Any downloads?)

## Skills Created or Evolved
(List any new skills created or existing skills modified. If none, explain why for EACH unmet need.)

## Task-Derived Needs
(What skill needs were identified from task execution patterns? Any skill_needs.yaml signals addressed?)

## Experience Updates
- success_experience: N signals added
- failure_experience: N signals added
- useful_tips: N signals added
- skill_needs addressed: N
- Stale entries cleaned: N

## Notes
(observations for next cycle)
\`\`\``;

  return identity + reportsSection(recentReports) + task;
}

export function buildTaskAgentPrompt(recentReports: string[], reportPath: string, opts?: { taskAutoApprove?: boolean }): string {
  const autoApprove = opts?.taskAutoApprove !== false;

  const identity = `You are the **Task Agent** — one of three parallel agents in a skill-evolver evolution cycle.
Your core mission is: **Decompose user objectives into actionable automated tasks.**
You are NOT waiting for perfect conditions. You actively plan tasks that provide value.
You have bypassPermissions — you can read and write any file needed.

${CRITICAL_PATH}

## Your Data Paths

**Write access:**
- \`~/.skill-evolver/tasks/tasks.yaml\` (central task store)
- \`~/.claude/skills/task-planner/buffer/ideas.yaml\` (idea scratchpad)
- \`~/.claude/skills/task-planner/tasks/_rejected.yaml\` (rejection tracking)

**Read access:**
- \`~/.claude/skills/user-context/context/\` and \`tmp/\` (user profile)
- \`~/.claude/skills/skill-evolver/tmp/\` (technical experience)
- \`~/.claude/skills/\` (skill inventory — list all available skills)
- \`~/.claude/skills/skill-evolver/reference/permitted_skills.md\` (evolved skills list)
- Session logs at \`~/.claude/projects/\`
- \`~/.claude/skills/task-planner/reference/\` (task schema and guides)

**Do NOT touch:**
- \`~/.claude/skills/user-context/\` data files (another agent handles this)
- \`~/.claude/skills/skill-evolver/tmp/\` (another agent handles this)
- \`~/.claude/skills/*/SKILL.md\` (do not modify any skill files)`;

  const task = `
${SCRIPTS_REFERENCE}

## Your Workflow

### Phase 1: Objective Decomposition (MANDATORY — do not skip)

This is your most important step. You MUST complete it for every objective.

Read \`~/.claude/skills/user-context/context/objective.yaml\`. For **each** objective:

1. What is the current status of this objective? (Infer from session logs)
2. What recurring checks, monitoring, or automation could help?
3. What information gathering would be valuable?

**Decomposition template** (use for each objective):
\`\`\`
Objective: "<objective text>"
  Current status: <inferred from session logs>
  Potential tasks:
    - <task idea 1> (type: info-gathering / quality-check / monitoring / project-work)
    - <task idea 2>
  Decision: <create / skip (with specific reason)>
\`\`\`

### Phase 2: Experience-Driven Tasks

Read \`~/.claude/skills/skill-evolver/tmp/\`:
- **failure_experience.yaml** → Is there a preventive check task that could catch these failures early?
- **success_experience.yaml** → Is there a task to systematically apply proven approaches?
- **useful_tips.yaml** → Any tips that suggest a useful monitoring task?

### Phase 3: Session Pattern Analysis

Use scripts to scan recent sessions:
- What does the user repeatedly do manually? (→ automate)
- What information does the user repeatedly query? (→ scheduled report)
- What errors keep recurring? (→ preventive check)

### Phase 4: Skill Awareness (IMPORTANT — co-evolution)

Understand what skills are available so you can leverage them and identify gaps:

1. **List available skills**: \`ls ~/.claude/skills/\`
2. **Check evolved skills**: Read \`~/.claude/skills/skill-evolver/reference/permitted_skills.md\`
3. **For each task you plan to create**, consider:
   - Which existing skills could help this task execute better? → set \`relatedSkills\` field
   - Does this task need a skill that doesn't exist yet? → create a **skill-building task**
4. **Detect skill gaps**: If an objective requires capabilities no existing skill provides, create a skill-building task to fill that gap

### Phase 5: Task Lifecycle Management

Read existing tasks from \`~/.skill-evolver/tasks/tasks.yaml\`:
- Check artifact quality (browse \`~/.skill-evolver/tasks/<id>/artifacts/\`)
- Is the schedule still appropriate?
- Should any task be adjusted, paused, or removed?
- For skill-building tasks: has the target skill been created? If yes → mark completed

### Phase 6: Decision and Creation

Combine analysis from Phases 1-5. Create tasks following the schema in \`~/.claude/skills/task-planner/reference/task_schema.md\`.

**Task safety tiers** (prefer safer categories first):
1. **Information gathering** — Always safe: news, trends, summaries, monitoring
2. **Quality checks** — Low risk: lint, type-check, dependency audit, security scan
3. **Project monitoring** — Low risk: progress tracking, status reports
4. **Project work** — Medium risk: code generation, documentation

**Auto-approve is ${autoApprove ? "ON" : "OFF"}**. ${autoApprove ? "Set agent-created tasks to `status: active` and `approved: true` — they will run immediately on schedule." : "Set agent-created tasks to `status: pending` and `approved: false` — user must approve via dashboard."}

**Check \`~/.claude/skills/task-planner/tasks/_rejected.yaml\`** before creating — do not re-propose rejected tasks.

**Standard task format** (append to tasks array in tasks.yaml):
\`\`\`yaml
- id: "t_YYYYMMDD_HHmm_xxx"    # date + 3-char random hex
  name: "Short descriptive name"
  description: "What and why"
  prompt: "Full self-contained prompt for Claude"
  schedule:
    type: cron               # or "one-shot"
    cron: "0 8 * * *"       # 5-field cron
  status: ${autoApprove ? "active" : "pending"}
  approved: ${autoApprove ? "true" : "false"}
  source: agent
  model: sonnet              # Prefer sonnet unless deep reasoning needed
  tags: ["tag1", "tag2"]
  relatedSkills: ["skill-name"]   # optional: skills this task should leverage
  runCount: 0
  createdAt: "<ISO datetime>"
\`\`\`

**Skill-building task format** (special task type for creating/improving skills):
\`\`\`yaml
- id: "t_YYYYMMDD_HHmm_xxx"
  name: "Create <skill-name> skill"
  description: "Create a skill for <what it does> based on <evidence>"
  prompt: |
    You are a skill builder. Your task is to create (or improve) a Claude Code skill
    using the skill-creator methodology.

    TARGET SKILL: <skill-name>
    GOAL: <what the skill should do>
    EVIDENCE: <why this skill is needed — specific patterns, failures, or user needs>

    INSTRUCTIONS:
    1. Read ~/.claude/skills/skill-creator/SKILL.md THOROUGHLY — it defines the
       standard process for skill creation including eval, benchmark, and description optimization.
    2. Check if ~/.claude/skills/<skill-name>/ already exists
       - If exists: Read current SKILL.md, identify improvements, make targeted edits
       - If new: Create the skill directory and write SKILL.md following skill-creator's anatomy:
         - YAML frontmatter with name and trigger-optimized description (make it "pushy")
         - Instructions using imperative form, explaining WHY not just WHAT
         - Under 500 lines; use references/ for detailed docs
    3. Write basic evals to ~/.claude/skills/<skill-name>/evals/evals.json with 2-3
       realistic test prompts and expected outputs
    4. Register the skill in ~/.claude/skills/skill-evolver/reference/permitted_skills.md
    5. Write a report summarizing: what was created/changed, eval results if any, description design rationale
  schedule:
    type: one-shot
    at: "<ISO datetime — schedule within next few hours>"
  status: ${autoApprove ? "active" : "pending"}
  approved: ${autoApprove ? "true" : "false"}
  source: agent
  model: sonnet
  tags: ["skill-building"]
  skillTarget: "<skill-name>"     # REQUIRED for skill-building tasks
  runCount: 0
  createdAt: "<ISO datetime>"
\`\`\`

**When to create a skill-building task:**
- An objective needs capabilities no existing skill provides
- Multiple tasks share patterns that should be codified
- Task failures reveal a knowledge gap that a skill could fill
- User repeatedly needs guidance in a specific domain

### Phase 7: Write Report

Write your report to:
\`${reportPath}\`

**MANDATORY report sections** (you must answer all of these):

\`\`\`markdown
# Task Agent Report — {date}

## Objective Decomposition
(For EACH objective in objective.yaml, show the decomposition template above)

## Experience-Driven Analysis
(What failure/success patterns suggest preventive tasks?)

## Session Patterns
(What recurring manual actions or queries did you find?)

## Skill Awareness
(Available skills inventory. Skill gaps identified. Any skill-building tasks proposed?)

## Existing Tasks Review
(Status of each existing task — healthy/needs-adjustment/stale? Skill-building tasks: target skill created?)

## Tasks Created
(List each new task with name, schedule, and rationale. If zero, explain why EACH objective doesn't warrant a task.)
(For skill-building tasks, include skillTarget and evidence.)

## Tasks Modified
(Any changes to existing tasks)

## Ideas Buffer Updates
(Ideas added or removed)

## Notes
(observations for next cycle)
\`\`\``;

  return identity + reportsSection(recentReports) + task;
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

  // Include related skills context if available
  let skillsSection = "";
  if (task.relatedSkills && task.relatedSkills.length > 0) {
    skillsSection = `\n## Related Skills

The following skills are relevant to this task. Read their SKILL.md files for guidance before starting:
${task.relatedSkills.map(s => `- \`~/.claude/skills/${s}/SKILL.md\``).join("\n")}

These skills contain best practices and patterns that will help you execute this task more effectively.\n`;
  }

  const taskSection = `
## Task Details

- **Name**: ${task.name}
- **Description**: ${task.description ?? "(no description)"}
- **Task ID**: ${task.id}
${task.skillTarget ? `- **Skill Target**: ${task.skillTarget} (this is a skill-building task)\n` : ""}
${skillsSection}
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

${CRITICAL_PATH}`;

  let rSection = "";
  if (recentReports.length > 0) {
    rSection = `\n## Recent Evolution Reports (for context)\nHere are the last ${recentReports.length} reports:\n\n`;
    recentReports.forEach((report, i) => {
      rSection += `### Report ${i + 1}\n${report}\n\n`;
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

3. **Emit skill-need signals (IMPORTANT — task-skill co-evolution)** — If the task struggled, failed, or had to improvise in a domain where a skill could help:
   - Write a skill-need signal to \`~/.claude/skills/skill-evolver/tmp/skill_needs.yaml\`
   - Format:
   \`\`\`yaml
   entries:
     - need: "Description of what skill is needed"
       source_task: "${task.id}"
       task_name: "${task.name}"
       evidence: "Why this skill is needed — what went wrong or was difficult"
       priority: "high"    # high if task failed, medium if task struggled
       date: "<today ISO>"
       addressed: false
   \`\`\`
   - This signal will be picked up by the Skill Agent in the next evolution cycle as a priority need.

4. **Skill-building task verification** — If this task has \`tags: ["skill-building"]\` or \`skillTarget\`:
   - Check if the target skill was actually created at \`~/.claude/skills/<skillTarget>/SKILL.md\`
   - If created: verify it's registered in \`~/.claude/skills/skill-evolver/reference/permitted_skills.md\`
   - If NOT created: note the failure and emit a skill-need signal so the Skill Agent can handle it

5. **Check if follow-up needed** — Determine if the task result warrants any follow-up actions (e.g., a new task, an update to user-context, a skill modification).

6. **Update idea buffer** — If the task outcome suggests new ideas for tasks or skills, add them to the idea buffer.

7. **Write review report** — Write a brief markdown report to:
   \`${reportPath}\`
   Include: quality assessment, lessons extracted, skill-need signals emitted, and any follow-up recommendations.`;

  return identity + rSection + taskSection;
}
