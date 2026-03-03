# skill-evolver

**Create and evolve skills automatically.**

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
2. **Conservative by default** — proposes changes, doesn't force them. You stay in control
3. **Evidence-based** — every skill mutation is grounded in actual conversation history
4. **Incremental** — small, frequent improvements over big rewrites

## How It Works

```
┌─────────────────────────────────────────────┐
│              skill-evolver                   │
│                                             │
│  ┌─────────┐    ┌──────────┐    ┌────────┐ │
│  │  Timer   │───▶│ Analyzer │───▶│ Writer │ │
│  │ (1h/manual)   │ (Claude) │    │(Skills)│ │
│  └─────────┘    └──────────┘    └────────┘ │
│       │              │              │       │
│       │         reads from     writes to    │
│       │              │              │       │
│       ▼              ▼              ▼       │
│  ┌─────────────────────────────────────┐    │
│  │   ~/.claude/ conversation logs      │    │
│  │   ~/.claude/commands/ (skills)      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

1. **Trigger** — on a configurable interval (default: 1 hour) or manually from the UI
2. **Collect** — gather recent Claude Code conversation logs
3. **Analyze** — a background Claude Code instance reviews the logs, identifies learnable moments
4. **Propose** — generate skill create/update/delete proposals
5. **Apply** — write the skill files (with optional user approval)

## Getting Started

> 🚧 Under active development

```bash
git clone https://github.com/nanxingw/skill-evolver.git
cd skill-evolver
# Setup instructions coming soon
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `interval` | `1h` | How often to run the evolution cycle |
| `auto_apply` | `false` | Apply skill changes without confirmation |
| `log_path` | `~/.claude/` | Where to find conversation logs |
| `skills_path` | `~/.claude/commands/` | Where to write skills |

## License

MIT
