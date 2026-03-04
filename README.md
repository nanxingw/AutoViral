# skill-evolver

**Create and evolve Claude Code skills automatically.**

## The Problem

Claude Code is a powerful agent — but it doesn't learn. Every session starts from zero. Failed approaches are repeated, successful patterns are forgotten, and user preferences must be re-explained. The built-in skill system exists, but no one writes skills proactively. They rot or never get created at all.

## The Philosophy

**Skills should write themselves.**

The best workflow isn't one where you manually distill every lesson into a skill file. It's one where your agent reflects on its own history — what worked, what failed, what the user actually wanted — and turns those insights into reusable skills, automatically.

skill-evolver is a background process that periodically launches a Claude Code instance to review past conversation logs. It extracts:

- **Failure patterns** — tasks that went wrong and why
- **Success patterns** — approaches that worked well and should be codified
- **User preferences** — recurring requests, style choices, tool preferences
- **Skill candidates** — new skills to create, or existing skills to sharpen

Then it acts: creating new skills, updating existing ones, pruning outdated ones. Over time, your Claude Code gets *better at being your Claude Code*.

## Core Principles

1. **Zero friction** — runs in the background, no manual intervention required
2. **Conservative by default** — evidence-based evolution, not impulsive changes
3. **Evidence-based** — every skill mutation is grounded in actual conversation history
4. **Incremental** — small, frequent improvements over big rewrites

## How It Works

```
┌──────────────────────────────────────────────────┐
│                 skill-evolver                     │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌────────────┐ │
│  │  Timer /  │───▶│ Analyzer │───▶│   Writer   │ │
│  │  Manual   │    │ (Claude) │    │  (Skills)  │ │
│  └──────────┘    └──────────┘    └────────────┘ │
│       │               │               │         │
│       │          reads from       writes to      │
│       │               │               │         │
│       ▼               ▼               ▼         │
│  ┌──────────────────────────────────────────┐   │
│  │  ~/.claude/projects/   (session logs)    │   │
│  │  ~/.claude/skills/     (evolved skills)  │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

1. **Trigger** — on a configurable interval (default: 1 hour after last cycle) or manually from the web dashboard
2. **Collect** — gather recent Claude Code conversation logs from `~/.claude/projects/`
3. **Analyze** — a background Claude Code instance reviews the logs, extracts signals about user preferences, successes, failures, and tips
4. **Accumulate** — signals are stored in `tmp/` YAML files; only when evidence is strong enough (3+ sessions, 2+ days) do they graduate to confirmed knowledge
5. **Evolve** — create new skills, update existing ones, or refine user context based on accumulated evidence

## Two Meta-Skills

skill-evolver installs two core skills into `~/.claude/skills/` that power the evolution:

### user-context

Tracks **who the user is** across three pillars:

- **Preference** — tool choices, code style, communication preferences
- **Objective** — current tasks, project goals, career direction
- **Cognition** — personality traits, decision-making patterns, communication style

### skill-evolver

Tracks **what works technically** across three categories:

- **Success experience** — patterns and approaches that worked well
- **Failure experience** — approaches that failed or caused problems
- **Useful tips** — non-obvious shortcuts and workarounds

When accumulated experience is strong enough, it automatically creates standalone Claude Code skills.

## Getting Started

### Install

```bash
npm install -g skill-evolver
```

This will:
- Install the `skill-evolver` CLI
- Automatically copy the two meta-skills (user-context, skill-evolver) to `~/.claude/skills/`

### Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Usage

**Start the daemon** (runs in background with web dashboard):

```bash
skill-evolver start
```

This starts the evolution scheduler and a web dashboard at `http://localhost:3271`.

**Run a single evolution cycle**:

```bash
skill-evolver evolve
```

**Open the dashboard**:

```bash
skill-evolver dashboard
```

**Check status**:

```bash
skill-evolver status
```

**Stop the daemon**:

```bash
skill-evolver stop
```

### Web Dashboard

The dashboard at `http://localhost:3271` provides:

- **Dashboard** — current status, live evolution output, manual trigger button
- **Reports** — history of all evolution cycle reports
- **Data Browser** — browse accumulated signals and confirmed knowledge across all 6 pillars (grouped into User Context and Skill Evolver)
- **Settings** — configure interval, model, auto-run toggle

Real-time updates via WebSocket — no need to refresh the page.

## Configuration

Stored in `~/.skill-evolver/config.yaml`.

| Option | Default | Description |
|--------|---------|-------------|
| `interval` | `1h` | Time between evolution cycles (e.g., `30m`, `2h`). Timer starts after the previous cycle completes. |
| `model` | `opus` | Claude model to use for the evolution agent |
| `autoRun` | `true` | Automatically run cycles on the configured interval |
| `port` | `3271` | Web dashboard port |
| `maxReports` | `50` | Maximum number of evolution reports to keep |
| `reportsToFeed` | `5` | Number of recent reports to provide as context to the evolution agent |

You can also update configuration via the CLI:

```bash
skill-evolver config set interval 30m
skill-evolver config set model sonnet
skill-evolver config get
```

## Evolution Philosophy

skill-evolver uses an **accumulate-then-graduate** approach:

1. **Signals** are extracted from session logs — each observation is tagged with session ID, date, and detail
2. **Accumulation** happens in `tmp/` YAML files — signals are deduplicated and merged with existing observations
3. **Graduation** occurs only when evidence is strong: 3+ distinct sessions, spanning 2+ days, with no contradictions
4. **Staleness** is cleaned automatically — observations older than 60 days with few signals are removed

This prevents premature conclusions. A single session preference won't become a permanent rule — but a pattern that appears consistently across multiple days will.

## File Structure

```
~/.claude/skills/
  user-context/
    context/          # Graduated knowledge (confirmed)
      preference.yaml
      objective.yaml
      cognition.yaml
    tmp/              # Accumulating observations
      preference_tmp.yaml
      objective_tmp.yaml
      cognition_tmp.yaml
    SKILL.md

  skill-evolver/
    reference/
      permitted_skills.md   # Skills this agent can modify
    tmp/              # Accumulating experience
      success_experience.yaml
      failure_experience.yaml
      useful_tips.yaml
    SKILL.md

~/.skill-evolver/
  config.yaml         # Configuration
  reports/            # Evolution cycle reports
```

## License

MIT
