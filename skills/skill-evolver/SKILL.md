---
name: skill-evolver
description: "Technical experience knowledge base. Contains accumulated success patterns, failure patterns, and useful tips from past Claude Code sessions. Read tmp/ files to avoid known pitfalls and apply proven approaches. Use this skill whenever you are about to try an approach that might have known issues, or when looking for best practices the user has benefited from before. During evolution cycles, this skill drives need-driven skill creation — discovering user needs and finding or creating skills to address them."
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Skill Evolver — Technical Experience Base

This skill maintains a structured record of **what works and what doesn't** from past Claude Code sessions. It tracks three categories of experience:

| Category | File | What it captures |
|----------|------|-----------------|
| **Success** | `tmp/success_experience.yaml` | Approaches and patterns that worked well |
| **Failure** | `tmp/failure_experience.yaml` | Approaches that failed or caused problems |
| **Tips** | `tmp/useful_tips.yaml` | Non-obvious shortcuts, workarounds, and techniques |

When experience accumulates enough evidence, the evolution process creates standalone Claude Code skills from it.

---

## Data Location

All data files are at `~/.claude/skills/skill-evolver/`.

### tmp/ — Accumulated Experience

```yaml
# Example entry in tmp/success_experience.yaml
entries:
  - content: "Running tsc --noEmit before committing TypeScript catches type errors early"
    signals:
      - session: "sess-001"
        date: "2026-02-28"
        detail: "Agent ran tsc first, caught type error before commit"
    first_seen: "2026-02-28"
    last_seen: "2026-03-02"
    times_seen: 2
    applicable_to: ["typescript"]
```

### reference/ — Metadata

| File | Contents |
|------|----------|
| `reference/permitted_skills.md` | Skills created by the evolution process (modifiable) |
| `reference/runtime_guide.md` | How to use stored experience during normal work |
| `reference/evolution_guide.md` | Full manual for the evolution cycle |

---

## How to Use This Skill

### During normal work (runtime)

Read `reference/runtime_guide.md` for instructions on how to leverage stored experience — check for known failures before trying risky approaches, and apply proven success patterns.

### During an evolution cycle (background task)

Read `reference/evolution_guide.md` for the full operational manual on scanning session logs, adding signals, creating skills, and managing the experience base.
