# Skill Evolver — Overall Design Document

> **Create and evolve skills automatically.**

---

## 1. Project Philosophy

Claude Code is a powerful agent, but it starts every session from scratch. It doesn't accumulate experience, codify user preferences, or learn from its own failures. The skill system exists — but nobody writes skills proactively.

**Skill Evolver** closes this loop. It periodically spawns a background Claude Code instance that reviews conversation history, accumulates insights through two meta-skills (user-context and skill-evolver), and evolves them into actionable skills when the time is right.

### Core Principles

1. **Evolution over Instruction** — Knowledge isn't written; it *evolves*. Observations accumulate in `tmp` and only graduate to `context` or become skills after repeated validation.
2. **Two Pillars** — `user-context` (who the user is) and `skill-evolver` (what works) are orthogonal concerns.
3. **Claude is the Engine** — No custom agent logic. We spawn the user's installed `claude` CLI and let Claude read logs, judge, and write files. The orchestrator only handles scheduling and launching.
4. **Keep it Simple** — Minimal YAML fields, no complex numerical formulas, let Claude's understanding do the judging.

---

## 2. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                          skill-evolver                                │
│                                                                       │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────┐ │
│  │   Scheduler   │───▶│   Orchestrator    │───▶│   Claude Code CLI  │ │
│  │ (cron/manual) │    │   (Node.js)       │    │ (bypassPermissions) │ │
│  └──────────────┘    └───────────────────┘    └─────────┬──────────┘ │
│                                                          │            │
│                       Orchestrator only:                  │            │
│                       1. Read recent 5 reports            │            │
│                       2. Spawn claude                     │            │
│                       3. Manage reports (keep 50)         │            │
│                                                          │            │
│                       Claude does everything:             │            │
│                       1. Read session logs                │            │
│                       2. Read/write tmp and context       │            │
│                       3. Create/update skills             │            │
│                       4. Write completion report          │            │
│                                                          │            │
│                              ┌────────────────────────────┤            │
│                              │                            │            │
│                              ▼                            ▼            │
│                    ┌──────────────────┐        ┌──────────────────┐   │
│                    │  user-context    │        │  skill-evolver   │   │
│                    │  (meta-skill)    │        │  (meta-skill)    │   │
│                    │ ~/.claude/skills/│        │ ~/.claude/skills/│   │
│                    └──────────────────┘        └──────────────────┘   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                  Web Dashboard (localhost:3271)                │   │
│  │  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │   │
│  │  │ Reports   │ │ Settings │ │ Skills    │ │ Trigger      │  │   │
│  │  └───────────┘ └──────────┘ └───────────┘ └──────────────┘  │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

    Claude reads:
    ~/.claude/projects/*/   (session logs, JSONL)
    ~/.claude/history.jsonl (command history)

    Claude writes:
    ~/.claude/skills/       (meta-skill data + evolved skills)
    ~/.skill-evolver/reports/  (completion reports)
```

---

## 3. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Language** | TypeScript | Type safety, npm ecosystem |
| **Runtime** | Node.js (>=18) | Cross-platform, native child_process |
| **Backend** | Hono | Ultra-lightweight (14KB), serves API + static assets |
| **Frontend** | Svelte 5 + Vite | Tiny bundles, compiler-based |
| **Scheduling** | node-cron | In-process, zero-config |
| **Data Store** | YAML files | Human-readable, LLM-friendly, simple |
| **Claude Code** | CLI subprocess (`claude -p`) | Zero deps, reuses user's installed Claude Code. Inspired by [pneuma-skills](https://github.com/pandazki/pneuma-skills) |
| **Package** | npm global package | `npm install -g skill-evolver` |

### Key Design Decisions

- **No Agent SDK** — direct `child_process.spawn()` of the `claude` binary
- **No custom agents** — Claude Code itself is the best agent; we just give it the right skills and permissions
- **bypassPermissions** — background evolution tasks need full file read/write access

---

## 4. Two Meta-Skills Design

Both meta-skills are installed to `~/.claude/skills/`. Skills created by the evolver also go directly into `~/.claude/skills/`.

### 4.1 `user-context` — Who Is The User?

**Directory structure**:
```
~/.claude/skills/user-context/
├── SKILL.md                   # Router: rich description + data overview + scenario routing
├── reference/
│   ├── runtime_guide.md       # For normal sessions: how to READ and APPLY user profile data
│   └── evolution_guide.md     # For background evolution: ADD SIGNAL, GRADUATE, CLEAN STALE, etc.
├── context/                   # Graduated user context (confirmed data)
│   ├── preference.yaml        # User preferences
│   ├── objective.yaml         # User goals (small to large)
│   └── cognition.yaml         # User cognition (personality, MBTI, thinking patterns)
└── tmp/                       # Accumulating observations (pre-graduation)
    ├── preference_tmp.yaml
    ├── objective_tmp.yaml
    └── cognition_tmp.yaml
```

**SKILL.md as Router**: The SKILL.md file is a concise entry point that contains a rich description of the skill's purpose and data, then routes Claude to the appropriate guide:
- **During normal work** -> `reference/runtime_guide.md` (read-only: apply stored user knowledge to personalize responses)
- **During evolution cycles** -> `reference/evolution_guide.md` (read-write: scan logs, add signals, graduate entries, handle contradictions)

**YAML field design (minimal)**:

```yaml
# preference_tmp.yaml — accumulating preference observations
entries:
  - content: "User prefers bun over npm"
    signals:
      - session: "abc-123"
        date: "2026-03-01"
        detail: "User corrected: 'use bun install'"
      - session: "def-456"
        date: "2026-03-02"
        detail: "Project has bun.lockb"
    first_seen: "2026-03-01"
    last_seen: "2026-03-02"
    times_seen: 2
```

```yaml
# preference.yaml — confirmed preferences
entries:
  - content: "User prefers bun over npm"
    graduated: "2026-03-05"
    source_signals: 4
    last_validated: "2026-03-05"
```

### 4.2 `skill-evolver` — What Has Been Learned?

**Directory structure**:
```
~/.claude/skills/skill-evolver/
├── SKILL.md                   # Router: rich description + data overview + scenario routing
├── reference/
│   ├── permitted_skills.md    # List of skills this evolver has permission to modify (self-created only)
│   ├── runtime_guide.md       # For normal sessions: check known failures/successes before trying approaches
│   └── evolution_guide.md     # For background evolution: full operation manual
├── tmp/                       # Accumulating intermediate experience
│   ├── success_experience.yaml
│   ├── failure_experience.yaml
│   └── useful_tips.yaml
```

**SKILL.md as Router**: Same pattern as user-context. The SKILL.md describes what experience data is available, then routes:
- **During normal work** -> `reference/runtime_guide.md` (check for known failures before trying risky approaches, apply proven patterns)
- **During evolution cycles** -> `reference/evolution_guide.md` (scan logs, add signals, create/update skills when ready)

**Skill creation flow**:
1. Claude finds recurring experience in tmp with broad applicability
2. Claude judges it's ready to become a standalone skill
3. Claude uses Write tool to create `~/.claude/skills/<new-skill>/SKILL.md`
4. Claude registers the new skill name in `permitted_skills.md`
5. In future cycles, Claude can update registered skills based on new experience

---

## 5. Evolution Mechanism

### 5.1 Two-Level Evolution: tmp → context/skill

Instead of complex multi-stage pipelines with numerical formulas, we use **two-level evolution** where Claude judges when to graduate.

```
  ┌───────────────┐                    ┌───────────────┐
  │     tmp        │   Claude judges    │   context     │
  │  (accumulate)  │ ── graduate ──▶   │  (confirmed)  │
  │                │                    │               │
  │ multiple       │                    │ minimal       │
  │ signals        │                    │ record        │
  └───────────────┘                    └───────────────┘
        ▲                                     │
        │ new signal                          │ contradiction
        │                                     ▼
   session log scan                     demote back to tmp
```

### 5.2 Graduation Guidelines (in SKILL.md, not hardcoded)

1. **Repetition** — observed in 3+ different sessions
2. **Explicitness** — user explicitly stated it weighs much more than implicit inference
3. **Consistency** — no contradicting evidence, or contradictions far fewer than support
4. **Time span** — observations spanning 2+ days to prevent single-session overfitting
5. **Caution** — better to wait one more cycle than graduate too early

### 5.3 YAML Field Philosophy

**Minimal**: each record only needs `content`, `signals` (with session/date/detail), `first_seen`, `last_seen`, `times_seen`.

**Traceable**: every signal records its source session and date.

**Timely**: `last_seen` lets Claude judge if information is stale.

---

## 6. Orchestrator Design

The orchestrator is minimal — it does exactly three things:

### 6.1 Claude Code CLI Invocation

```typescript
import { spawn } from "child_process";

async function runEvolutionCycle() {
  const recentReports = await readRecentReports(5);
  const prompt = buildPrompt(recentReports);

  const claude = spawn("claude", [
    "-p", prompt,
    "--output-format", "stream-json",
    "--model", config.model || "sonnet",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
  ], {
    cwd: process.env.HOME,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return waitForCompletion(claude);
}
```

### 6.2 Prompt Structure

```
Identity: This task is specifically for using user-context and skill-evolver
          skills to perform evolution.

Recent reports: [last 5 completion reports]

Task:
1. Browse Claude Code session logs, extract valuable signals
2. Use user-context skill to update tmp and context
3. Use skill-evolver skill to accumulate experience, create/update skills when ready
4. Write a brief completion report to ~/.skill-evolver/reports/
```

### 6.3 Report Management

- Reports stored at `~/.skill-evolver/reports/YYYY-MM-DD_HH-mm_report.md`
- Maximum 50 reports retained, oldest automatically deleted
- Last 5 reports fed as input to each evolution cycle for continuity

### 6.4 Session Log Format

Claude Code stores conversation logs at:
```
~/.claude/projects/<project-path-encoded>/<session-id>.jsonl
```

Each line is a JSON object with `type`, `message.content`, `sessionId`, `timestamp`, `cwd`. The SKILL.md files explain these paths and formats to guide Claude in efficient log browsing.

---

## 7. npm Package Structure

```
skill-evolver/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli.ts                # CLI argument parsing (commander)
│   ├── orchestrator.ts       # Orchestrator (schedule + spawn + reports)
│   ├── scheduler.ts          # node-cron scheduling
│   ├── reports.ts            # Report read/write/cleanup
│   ├── config.ts             # Configuration management
│   └── server/
│       ├── index.ts          # Hono server
│       ├── api.ts            # REST API routes
│       └── ws.ts             # WebSocket for real-time updates
├── web/                      # Svelte frontend
├── dist/                     # Compiled code
├── skills/                   # Meta-skill templates (copied on install)
│   ├── user-context/
│   │   ├── SKILL.md                          # Router
│   │   ├── reference/
│   │   │   ├── runtime_guide.md
│   │   │   └── evolution_guide.md
│   │   ├── context/{preference,objective,cognition}.yaml
│   │   └── tmp/{preference_tmp,objective_tmp,cognition_tmp}.yaml
│   └── skill-evolver/
│       ├── SKILL.md                          # Router
│       ├── reference/
│       │   ├── permitted_skills.md
│       │   ├── runtime_guide.md
│       │   └── evolution_guide.md
│       └── tmp/{success_experience,failure_experience,useful_tips}.yaml
└── docs/
```

### package.json

```json
{
  "name": "skill-evolver",
  "version": "0.1.0",
  "bin": { "skill-evolver": "./dist/index.js" },
  "files": ["dist/", "skills/"],
  "dependencies": {
    "hono": "^4.0.0",
    "js-yaml": "^4.1.0",
    "node-cron": "^3.0.0",
    "commander": "^12.0.0",
    "ws": "^8.0.0"
  }
}
```

Note: **No `@anthropic-ai/claude-agent-sdk`**. We call the user's installed `claude` CLI directly.

---

## 8. Web Dashboard

**Dashboard**: status, quick stats, manual trigger button.
**Reports**: timeline of completion reports with full text view.
**Data Browser**: view user-context and skill-evolver data (tmp + context).
**Settings**: interval, model selection, auto-run toggle.

```
GET  /api/status              # Orchestrator status
POST /api/trigger             # Manual trigger
GET  /api/reports             # Report list
GET  /api/reports/:filename   # Single report
GET  /api/context/:pillar     # View data by pillar
GET  /api/skills              # List evolved skills
GET  /api/config              # Get config
PUT  /api/config              # Update config
WS   /ws                      # Real-time updates
```

---

## 9. CLI Interface

```bash
npm install -g skill-evolver

skill-evolver start           # Start daemon + dashboard
skill-evolver stop            # Stop daemon
skill-evolver evolve          # Run single evolution cycle
skill-evolver dashboard       # Open dashboard in browser
skill-evolver status          # Show status
skill-evolver config set interval 2h
```

---

## 10. Security & Privacy

- **Local-only**: all data on user's machine, no telemetry
- **Session logs**: read-only access
- **bypassPermissions**: evolution Claude instance has full file access (necessary for writing skills)
- **Permission boundary**: `permitted_skills.md` tracks which skills the evolver can modify
- **Auth**: uses user's existing Claude Code authentication
- **Prerequisite**: requires Claude Code CLI installed

---

## 11. Implementation Roadmap

### Phase 1: Foundation (MVP)
- [ ] Project scaffolding
- [ ] Write two meta-skill SKILL.md files (critical! determines evolution quality)
- [ ] Initialize YAML file templates
- [ ] CLI launcher (wrap `claude -p` subprocess)
- [ ] Orchestrator (single cycle + report management)
- [ ] CLI basics (`skill-evolver evolve`)
- [ ] postinstall script

### Phase 2: Daemon & Dashboard
- [ ] Scheduler (node-cron)
- [ ] CLI daemon management
- [ ] Hono server + WebSocket
- [ ] Svelte dashboard

### Phase 3: Polish & Release
- [ ] Error handling & recovery
- [ ] npm package optimization
- [ ] Documentation
- [ ] First public release

---

*Document version: 2.1*
*Created: 2026-03-03*
*Updated: 2026-03-04*
*Status: Design Phase*
