# Task Schema Reference

This document defines the YAML format for tasks stored in `~/.skill-evolver/tasks/tasks.yaml`.

---

## Storage Format

All tasks are stored in a single YAML file as an array:

```yaml
tasks:
  - id: "t_20260306_1530_abc"
    name: "Daily lint check"
    description: "Run ESLint on the main project every morning"
    prompt: |
      Run ESLint on the project at ~/projects/main-app.
      Report any new warnings or errors since the last run.
    schedule:
      type: cron
      cron: "0 8 * * *"
    status: active
    approved: true
    source: user
    model: sonnet
    tags: ["linting", "code-quality"]
    runCount: 0
    createdAt: "2026-03-06T15:30:00.000Z"
  - id: "t_20260307_0900_def"
    name: "Check eval results"
    # ... next task ...
```

---

## Field Definitions

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier. Format: `t_YYYYMMDD_HHmm_<3-char-hex>`. |
| `name` | string | Short human-readable name. Keep under 60 characters. |
| `prompt` | string | Full prompt given to Claude when the task fires. Must be self-contained. |
| `schedule` | object | Schedule configuration (see below). |
| `status` | enum | `"active"`, `"paused"`, `"pending"`, `"completed"`, `"expired"`, `"running"` |
| `approved` | boolean | Whether user approved. User-created: `true`. Agent-suggested: `false`. |
| `runCount` | integer | Total executions. Start at `0`. |
| `createdAt` | string | ISO 8601 datetime of creation. |

### Schedule object

```yaml
# For recurring tasks:
schedule:
  type: cron
  cron: "0 8 * * *"    # 5-field cron expression

# For one-shot tasks:
schedule:
  type: one-shot
  at: "2026-03-07T10:00:00Z"   # ISO datetime
```

### Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | - | Detailed description of what the task does. |
| `model` | string | Config default | Claude model: `"opus"`, `"sonnet"`, `"haiku"`. |
| `source` | string | `"user"` | Who created: `"user"` or `"agent"`. |
| `tags` | string[] | `[]` | Categorization tags. |
| `lastRun` | string | - | ISO datetime of most recent execution. |
| `max_runs` | integer or null | `null` | Max executions. `null` = unlimited. |

---

## Status Lifecycle

```
pending ──(user approves)──> active ──(runs)──> active (recurring)
                                                  └──> completed (one-shot or max_runs)
active ──(user pauses)──> paused ──(user resumes)──> active
active ──(deactivated)──> expired
```

- `pending`: Agent-suggested, awaiting user approval. Will not execute.
- `active`: Approved and scheduled. Will execute on schedule.
- `paused`: Temporarily stopped. Retains schedule but will not execute.
- `running`: Currently being executed by the daemon.
- `completed`: One-shot that has run, or recurring that hit `max_runs`.
- `expired`: Deactivated or rejected.

---

## Cron Expression Format

Standard 5-field cron: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|-----------|---------|
| `0 * * * *` | Every hour on the hour |
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 * * 0` | Weekly on Sunday at midnight |

---

## Artifacts and Reports

When a task executes, the daemon stores outputs at:

```
~/.skill-evolver/tasks/<task-id>/
  artifacts/           # Persistent artifacts shared across runs
  reports/             # Per-run reports
    YYYY-MM-DD_HH-mm_report.md
```

---

## _rejected.yaml Format

Located at `~/.claude/skills/task-planner/tasks/_rejected.yaml`.

```yaml
entries:
  - name: "Auto-format on save"
    reason: "User prefers manual formatting control"
    rejected_at: "2026-03-06"
    original_source: "agent"
```

The evolution agent must check this file before proposing new tasks.
