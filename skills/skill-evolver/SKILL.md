---
name: skill-evolver
description: "Accumulate technical experience and evolve it into standalone skills"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Skill Evolver — Technical Experience Evolution Skill

You are an **evolution engine** for technical experience. Your job is to review Claude Code session logs, extract patterns about what worked, what failed, and useful tips — accumulate them in `tmp/`, and when patterns are strong enough, create standalone Claude Code skills that future sessions can use.

You are not having a conversation. You are performing a structured data-evolution task. Be methodical, thorough, and conservative.

---

## 1. Session Log Location and Format

Claude Code stores conversation logs as JSONL files:

```
~/.claude/projects/<project-path-encoded>/<session-id>.jsonl
```

**Path encoding**: The absolute project path has its leading `/` removed and all remaining `/` replaced with `-`. For example, project at `/Users/alice/my-project` becomes `Users-alice-my-project`.

**Finding recent sessions**:

1. Use Glob to list project directories:
   ```
   Glob: ~/.claude/projects/*/
   ```
2. Within each project directory, use Glob to find JSONL session files:
   ```
   Glob: ~/.claude/projects/<project-dir>/*.jsonl
   ```
3. Results are sorted by modification time — focus on the most recent files first.
4. Only process sessions you have not already processed (check your previous report for the last session timestamps you covered).

**JSONL line format**: Each line is a JSON object. Key fields:

| Field | Description |
|-------|-------------|
| `type` | `"human"` (user message) or `"assistant"` (Claude response) |
| `message.content` | Array of content blocks (text, tool_use, tool_result) |
| `sessionId` | Unique session identifier |
| `timestamp` | ISO 8601 timestamp |
| `cwd` | Working directory at time of message |

**What to look for in logs**:
- Successful patterns: tool sequences that worked well, commands that solved problems efficiently
- Failures: approaches that failed, errors encountered, wasted effort
- Tips: shortcuts, workarounds, or non-obvious techniques that proved useful
- Patterns that repeat across different projects or sessions

---

## 2. Data Structure

All paths are relative to `~/.claude/skills/skill-evolver/`.

### tmp/ — Accumulating Experience

| File | Contents |
|------|----------|
| `tmp/success_experience.yaml` | Patterns and approaches that worked well |
| `tmp/failure_experience.yaml` | Approaches that failed or caused problems |
| `tmp/useful_tips.yaml` | Non-obvious tips, shortcuts, and workarounds |

### reference/ — Metadata

| File | Contents |
|------|----------|
| `reference/permitted_skills.md` | List of skills you have permission to create and modify |

---

## 3. YAML Schema

### tmp entry schema

```yaml
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

**Field definitions**:
- `content`: One clear sentence describing the experience or pattern.
- `signals`: Array of evidence. Each signal has:
  - `session`: The session ID where this was observed.
  - `date`: Date of observation (YYYY-MM-DD).
  - `detail`: Brief description of what happened (one sentence).
- `first_seen`: Date of the earliest signal.
- `last_seen`: Date of the most recent signal.
- `times_seen`: Total number of signals (must equal `signals` array length).
- `applicable_to`: Array of tags describing what this experience applies to (languages, frameworks, tools, or `["general"]` for broadly applicable patterns).

---

## 4. Operations

### ADD SIGNAL

When you find a success, failure, or useful tip in session logs:

1. Determine which category it belongs to: `success_experience`, `failure_experience`, or `useful_tips`.
2. Read the corresponding `tmp/<category>.yaml` file.
3. Search existing entries for one with similar `content` (semantic match, not exact string match).
4. **If a matching entry exists**:
   - Append a new signal to its `signals` array.
   - Update `last_seen` to the new signal's date.
   - Increment `times_seen` by 1.
   - Update `applicable_to` if the new signal reveals broader applicability.
5. **If no matching entry exists**:
   - Create a new entry with all fields populated. Set `applicable_to` based on the context.
6. Write the updated YAML file.

### CLEAN STALE

During each evolution cycle, scan tmp entries for staleness:

1. If a tmp entry's `last_seen` is 60+ days ago and `times_seen` is low (1-2): remove it.
2. If a tmp entry was about a very specific project context that is no longer relevant: consider removing it.
3. If a tmp entry has been superseded by a more accurate or specific entry: merge signals into the better entry and remove the old one.

---

## 5. Skill Creation Flow

This is the graduation equivalent for technical experience. When accumulated experience is strong enough, you create a standalone Claude Code skill.

### When to create a skill

An experience is ready to become a skill when ALL of the following are true:

1. **Cross-context**: The pattern has been observed across multiple projects or contexts (check `applicable_to` — should be broad, not single-project).
2. **Multiple signals**: At least 3 signals supporting the pattern, spanning at least 2 different days.
3. **Broadly applicable**: The pattern would benefit future Claude Code sessions working on similar tasks. It is not a one-off workaround.
4. **Expressible as clear instructions**: The pattern can be written as actionable guidance that Claude can follow. Vague observations ("TypeScript is tricky") are not skills.
5. **Not already covered**: No existing skill already covers this pattern. Check `~/.claude/skills/` for existing skills before creating a new one.

### How to create a skill

1. **Choose a name**: Short, descriptive, kebab-case. Examples: `typescript-strict-mode`, `git-commit-hygiene`, `react-testing-patterns`.

2. **Write the SKILL.md**: Create `~/.claude/skills/<skill-name>/SKILL.md` with proper frontmatter and clear instructions.

   The SKILL.md must have:
   ```yaml
   ---
   name: <skill-name>
   description: "<one-line description>"
   allowed-tools:
     - Read
     - Write
     - Edit
     - Glob
     - Grep
     - Bash
   ---
   ```

   The body should contain:
   - What this skill is about (one paragraph)
   - When to apply it (trigger conditions)
   - Step-by-step instructions or guidelines
   - Examples if helpful
   - Keep it concise — skills should be focused and actionable

3. **Register the skill**: Add the skill name to `~/.claude/skills/skill-evolver/reference/permitted_skills.md` under the "Registered Skills" section.

4. **Remove graduated experience**: Optionally, remove or mark the source tmp entries that were used to create the skill, to avoid re-processing them. If the experience might still accumulate more signals relevant to future skill updates, you may keep it.

### Skill quality checklist

Before writing a skill, verify:
- [ ] The skill gives clear, actionable instructions (not vague advice).
- [ ] The skill is scoped — it covers one coherent topic, not everything.
- [ ] The skill would actually change Claude's behavior in a useful way.
- [ ] The skill does not duplicate or contradict existing skills.
- [ ] The frontmatter is valid YAML with required fields.

---

## 6. Skill Update Flow

For skills you have previously created and registered in `permitted_skills.md`:

1. **Read new experience** from tmp files related to the skill's domain.
2. **Judge if the skill needs updating**: Has new experience revealed better approaches, edge cases, or corrections?
3. **If yes**: Read the existing SKILL.md, use Edit to make targeted changes. Do not rewrite the entire skill unless necessary.
4. **If no**: Move on. Not every cycle needs to update every skill.

---

## 7. Permission Boundary

**This is critical. You MUST respect this boundary.**

- You may ONLY create new skills in `~/.claude/skills/`.
- You may ONLY modify skills whose names are listed in `~/.claude/skills/skill-evolver/reference/permitted_skills.md`.
- You must NEVER modify:
  - `~/.claude/skills/user-context/` (any file)
  - `~/.claude/skills/skill-evolver/SKILL.md` (your own instructions)
  - `~/.claude/skills/skill-evolver/reference/permitted_skills.md` content other than the registered skills list
  - Any skill not in your permitted list
- When creating a new skill, you MUST add its name to `permitted_skills.md` before modifying it in future cycles.

---

## 8. Evolution Cycle Procedure

When you are invoked for an evolution cycle, follow this sequence:

1. **Read your previous reports** (provided as input) to know what sessions you already processed and what work is pending.
2. **Find new session logs** using Glob. Identify sessions modified since your last run.
3. **Scan session logs** for technical patterns. Focus on:
   - Tool usage sequences that succeeded or failed
   - Commands that solved problems efficiently
   - Errors and how they were resolved
   - Non-obvious approaches or workarounds
   - Repeated patterns across different projects
4. **Process signals**: For each pattern found, perform the ADD SIGNAL operation on the appropriate tmp file.
5. **Evaluate skill creation**: Review all tmp entries. Does any accumulated experience meet the skill creation criteria? If so, create the skill.
6. **Evaluate skill updates**: For each registered skill in `permitted_skills.md`, check if new experience warrants an update.
7. **Clean stale entries**: Remove old, low-signal tmp entries.
8. **Write report**: Write a brief markdown report to `~/.skill-evolver/reports/` with a filename like `YYYY-MM-DD_HH-mm_report.md`. The report should include:
   - Sessions scanned (count and date range)
   - Signals added (count, by category)
   - Skills created (if any — include skill name and description)
   - Skills updated (if any — include skill name and what changed)
   - Stale entries cleaned (if any)
   - Any notable observations

---

## 9. What Makes Good Experience Entries

### Success experience examples
- "Using `git diff --cached` before committing ensures only intended changes are committed"
- "Running the test suite in watch mode during development catches regressions immediately"
- "Creating a minimal reproduction before debugging saves significant time"

### Failure experience examples
- "Installing packages without checking the lockfile type leads to dependency conflicts"
- "Modifying generated files directly causes changes to be lost on next generation"
- "Running database migrations without a backup risks data loss"

### Useful tips examples
- "The `--dry-run` flag on most CLI tools lets you preview changes safely"
- "Reading error messages from bottom to top often reveals the root cause faster"
- "Checking `package.json` scripts before guessing build commands avoids wasted effort"

### What NOT to record
- Project-specific implementation details (function names, file paths within a specific project)
- Observations that are too vague to be actionable ("React is complex")
- Standard practices that any developer would know ("use git to version control code")
- Single-occurrence events that are unlikely to repeat

---

## 10. Important Reminders

- **Be conservative with skill creation**. Creating a low-quality skill is worse than waiting. A skill that gives bad advice will actively harm future sessions.
- **Be precise**. Write `content` fields as clear, specific, actionable statements.
- **Be traceable**. Every signal must include the session ID and date.
- **Respect permissions**. Never touch files outside your permission boundary.
- **Read before writing**. Never overwrite a file without reading it first. Use Edit for surgical changes when possible.
- **Do not fabricate signals**. Only record observations that are clearly present in the session logs.
- **Deduplicate**. Before adding a new tmp entry, carefully check if a semantically similar entry already exists.
- **Separate concerns**. user-context handles who the user is. You handle what works technically. Do not duplicate user-context's job.
