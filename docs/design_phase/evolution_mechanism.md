# Evolution Mechanism: Two-Level Accumulation & Graduation

## Overview

The evolution mechanism turns raw conversation signals into reliable knowledge and skills. It follows a simple two-level model: observations accumulate in `tmp`, and when Claude judges them mature enough, they graduate to `context` (for user knowledge) or become standalone skills (for technical patterns).

The key insight: **Claude is the judge**. We don't use numerical confidence formulas. Instead, SKILL.md provides graduation guidelines, and Claude uses its understanding to decide when an observation has enough evidence to graduate.

---

## 1. Two-Level Model

```
  ┌───────────────┐                    ┌───────────────┐
  │     tmp        │   Claude judges    │   context     │
  │  (accumulate)  │ ── graduate ──▶   │  (confirmed)  │
  │                │                    │               │
  │ raw signals    │                    │ clean records │
  │ traceable      │                    │ minimal       │
  └───────────────┘                    └───────────────┘
        ▲                                     │
        │ new evidence                        │ contradiction/stale
        │                                     ▼
   session log scan                     demote back to tmp
```

### Why not three levels? Why not numerical confidence?

- **Simplicity**: The system operator is an LLM. It doesn't need to compute `0.73 >= 0.8 threshold`. It can read "seen 5 times across 4 sessions over 2 weeks" and understand that's strong evidence.
- **Flexibility**: Rigid formulas can't capture nuance. "User explicitly said 'always use bun'" is stronger than "saw bun.lockb in project" — Claude understands this naturally.
- **Maintainability**: fewer moving parts, fewer edge cases, fewer bugs.

---

## 2. Data Structures

### 2.1 tmp entries (accumulating)

```yaml
# Minimal fields, maximum traceability
entries:
  - content: "User prefers bun over npm for package management"
    signals:
      - session: "abc-123"
        date: "2026-03-01"
        detail: "User corrected agent: 'use bun install, not npm'"
      - session: "def-456"
        date: "2026-03-02"
        detail: "Project has bun.lockb, no package-lock.json"
      - session: "ghi-789"
        date: "2026-03-03"
        detail: "User said 'always use bun'"
    first_seen: "2026-03-01"
    last_seen: "2026-03-03"
    times_seen: 3
```

Fields:
- `content` — what was observed (one sentence)
- `signals` — evidence trail (session ID + date + brief description)
- `first_seen` / `last_seen` — time span
- `times_seen` — count

That's it. No confidence scores, no weights, no decay formulas.

### 2.2 context entries (confirmed)

```yaml
# Even more minimal — just the confirmed knowledge
entries:
  - content: "User prefers bun over npm for package management"
    graduated: "2026-03-05"
    source_signals: 4        # how many signals at graduation time
    last_validated: "2026-03-05"
```

Fields:
- `content` — the confirmed knowledge
- `graduated` — when it was promoted
- `source_signals` — evidence strength at graduation (for audit)
- `last_validated` — last time this was reinforced

### 2.3 tmp entries for skill-evolver

```yaml
# success_experience.yaml
entries:
  - content: "Running tsc --noEmit before committing TypeScript catches type errors early"
    signals:
      - session: "sess-001"
        date: "2026-02-28"
        detail: "Agent ran tsc first, caught type error before commit"
      - session: "sess-005"
        date: "2026-03-02"
        detail: "Confirmed again — tsc caught another issue"
    first_seen: "2026-02-28"
    last_seen: "2026-03-02"
    times_seen: 2
    applicable_to: ["typescript"]
```

The `applicable_to` field helps Claude judge when an experience is broad enough to become a standalone skill.

---

## 3. Graduation Guidelines

These are guidance principles written in SKILL.md, not hardcoded rules:

### For user-context (tmp → context)

| Guideline | Rationale |
|-----------|-----------|
| Observed in 3+ distinct sessions | Prevents single-conversation overfitting |
| Time span of at least 2 days | Ensures it's not a one-time preference |
| No contradicting evidence (or contradictions far fewer than support) | Consistency check |
| Explicit user statements weigh much more than implicit patterns | "Always use X" > inference from file patterns |
| When in doubt, wait one more cycle | Conservative by default |

### For skill-evolver (tmp → standalone skill)

| Guideline | Rationale |
|-----------|-----------|
| Pattern observed across multiple projects/contexts | Ensures generalizability |
| Multiple signals with broad applicability | Not project-specific quirk |
| Can be expressed as a clear, actionable instruction set | Skill quality check |
| Not already covered by an existing skill | Avoid duplication |

---

## 4. Operations

Each evolution cycle, Claude performs these operations on the data:

### On user-context data

| Operation | Description |
|-----------|-------------|
| **Add signal** | New evidence found → append to existing tmp entry's signals, or create new entry |
| **Graduate** | tmp entry has enough evidence → move content to context, remove from tmp |
| **Contradict** | New evidence against a context entry → demote back to tmp for re-observation |
| **Update** | Context entry needs refinement based on new signals → update in place |
| **Clean stale** | tmp entry hasn't been seen in a long time → remove |

### On skill-evolver data

| Operation | Description |
|-----------|-------------|
| **Add signal** | New success/failure/tip found → append to existing tmp entry or create new |
| **Create skill** | Accumulated experience ready to become standalone → write new SKILL.md + register in permitted_skills.md |
| **Update skill** | Registered skill needs improvement → modify existing SKILL.md |
| **Clean stale** | tmp entry no longer relevant → remove |

---

## 5. Conflict Resolution

**New evidence contradicts confirmed context:**
1. Single contradiction → note it but don't act. One data point shouldn't override established knowledge.
2. Repeated contradictions → demote the context entry back to tmp for re-observation.
3. User explicitly says "I changed my mind" → fast-track: update context immediately.

**Competing observations in tmp:**
- If two tmp entries contradict each other, Claude keeps both and waits for more evidence.
- The one with more recent and numerous signals will eventually graduate.

---

## 6. Staleness and Cleanup

Claude can remove stale entries from tmp using common sense:
- Entry hasn't been reinforced in 60+ days → likely no longer relevant
- Entry was about a specific project that's no longer active → remove
- Entry was superseded by a more specific or accurate observation → merge or remove

For confirmed context, staleness is less aggressive:
- Confirmed entries are assumed valid unless contradicted
- Very old entries (180+ days without reinforcement) can be flagged for review

---

## 7. Lifecycle Example

**"User prefers dark mode in generated UIs"**

**Day 1, Session 12:**
```
Claude scans logs, notices: user asked for dark mode in a dashboard.
→ ADD SIGNAL to preference_tmp.yaml
  content: "User prefers dark mode for generated UIs"
  signals: [{ session: "12", detail: "Requested dark mode for dashboard" }]
  times_seen: 1
```

**Day 3, Session 15:**
```
Claude notices: user again requested dark mode, for settings page.
→ ADD SIGNAL (reinforce existing entry)
  times_seen: 2
```

**Day 8, Session 20:**
```
User explicitly says: "I always want dark mode as default"
→ ADD SIGNAL (explicit statement, very strong)
  times_seen: 3, spans 3 sessions over 7 days
→ Claude judges: 3 sessions, 7 days, explicit statement → GRADUATE
→ Move to preference.yaml: graduated: "2026-03-08"
```

**Day 60, no further mention:**
```
Entry stays in context — confirmed knowledge doesn't expire quickly.
Still valid unless contradicted.
```

**Day 65, Session 45:**
```
User says: "Actually, use the system default now"
→ Claude judges: explicit contradiction → demote back to tmp
→ Create new tmp entry: "User prefers system default theme"
```

---

## 8. File Organization

```
~/.claude/skills/
├── user-context/
│   ├── SKILL.md
│   ├── context/                # Confirmed knowledge
│   │   ├── preference.yaml
│   │   ├── objective.yaml
│   │   └── cognition.yaml
│   ├── tmp/                    # Accumulating observations
│   │   ├── preference_tmp.yaml
│   │   ├── objective_tmp.yaml
│   │   └── cognition_tmp.yaml
│   └── scripts/
│
├── skill-evolver/
│   ├── SKILL.md
│   ├── reference/
│   │   └── permitted_skills.md
│   ├── tmp/
│   │   ├── success_experience.yaml
│   │   ├── failure_experience.yaml
│   │   └── useful_tips.yaml
│   └── scripts/
│
├── <evolved-skill-1>/         # Skills created by the evolver
│   └── SKILL.md
├── <evolved-skill-2>/
│   └── SKILL.md
└── ...

~/.skill-evolver/
└── reports/                   # Completion reports
    ├── 2026-03-03_14-30_report.md
    ├── 2026-03-03_15-30_report.md
    └── ...                    # Max 50, oldest auto-deleted
```

---

## 9. Design Principles

1. **Claude-native**: Claude reads YAML, understands context, and makes judgments. No numerical machinery.

2. **Traceable**: every graduated entry traces back to specific signals from specific sessions.

3. **Conservative**: graduation requires multiple signals across multiple sessions. False negatives (missing a real pattern) are preferred over false positives (codifying a wrong pattern).

4. **Self-correcting**: contradictions demote entries. Staleness allows cleanup. Claude can revise its own previous judgments.

5. **Minimal**: each YAML record has 4-5 fields. No bloat.

---

*Document version: 2.0*
*Created: 2026-03-03*
*Status: Design Phase*
