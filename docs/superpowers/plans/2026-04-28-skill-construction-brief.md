# Skill Construction Best-Practices Brief — AutoViral Phase 2

> **Audience:** Implementer subagents working on Phase 2 of `2026-04-28-autoviral-video-supremacy.md` — specifically tasks 2.6 / 2.7 / 2.8 (capability docs) and 2.9 / 2.10 (Python scripts) under `skills/autoviral/modules/assets/`.
>
> **Purpose:** Synthesize patterns from three external skill corpora (obra/superpowers, pandazki/pneuma-skills, garrytan/gstack), reconcile their disagreements, and translate the best ideas into AutoViral-specific paste-and-adapt templates.
>
> **Out of scope:** Implementing the templates as final docs. Modifying anything under `skills/autoviral/`. Running tests. Committing. Anything outside `docs/superpowers/plans/`.

---

## 0. Sources reviewed

| Repo | Path / Files | Relevance |
|---|---|---|
| **obra/superpowers** v5.0.7 (cached at `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/`) | `writing-skills/SKILL.md` (655 lines), `brainstorming/SKILL.md` (~165 lines), `test-driven-development/SKILL.md` (~370 lines), `verification-before-completion/SKILL.md` (~140 lines), `using-superpowers/SKILL.md` (~120 lines) | The meta-skill ground truth. Defines TDD-for-skills, frontmatter rules, CSO discipline, Red Flags / rationalization tables, dot-graph conventions. |
| **pandazki/pneuma-skills** (cloned at `/tmp/pneuma-skills`) | `modes/clipcraft/skill/SKILL.md` (376 lines), `references/craft.md` (272), `references/workflows.md` (699), `references/filter-retries.md` (129), `references/character-consistency.md` (220), `references/reference-directives.md` (131), `scripts/make-character-sheet.mjs` (171) | The closest analogue to AutoViral by domain. Heavy production skill, reference-doc patterns, taste essay, failure-signature decision trees, deterministic-recovery script shape. |
| **garrytan/gstack** (cloned at `/tmp/gstack` — clone succeeded on retry) | Top-level `SKILL.md` (909 lines, auto-generated from `SKILL.md.tmpl`), surveyed `qa/SKILL.md`, headers of 40+ sibling skill dirs (`investigate`, `ship`, `office-hours`, `plan-ceo-review`, etc.) | Production-engineering skills. Frontmatter has version + preamble-tier + allowed-tools + triggers fields. Heavy operational scaffolding (preamble script, telemetry, completion-status protocol, voice rules). |
| **AutoViral self-audit** | `skills/autoviral/SKILL.md`, `modules/{assets,assembly}/capabilities/*.md` (samples: `dreamina-mastery.md`, `quality-gate.md`, `fallback-strategy.md`, `beat-sync.md`), `modules/assets/scripts/openrouter_generate.py`, `docs/skill-structure-guide.md` | The codebase under construction. Shows existing density, frontmatter style, code-block conventions, mixed Chinese/English voice. |

**Source that failed:** First `git clone` of gstack hit `fetch-pack: invalid index-pack output` (curl 18 partial transfer). Re-clone with `--depth 1` succeeded; the entire gstack tree (~50 SKILL.md files) was available before /tmp got cleaned.

---

## 1. Frontmatter conventions

### 1.1 What the three sources agree on

All three converge on **two required YAML fields**: `name` (kebab-case identifier) and `description` (single-line trigger statement). AutoViral's `docs/skill-structure-guide.md` already mandates this shape.

```yaml
---
name: kebab-case-name
description: <one-line trigger>
---
```

### 1.2 Where they disagree

| Question | obra/superpowers | pneuma | gstack | AutoViral existing |
|---|---|---|---|---|
| Description style | "Use when X" — triggering conditions ONLY, never workflow | Long natural-language paragraph: "Use whenever the user wants to generate, edit… Trigger on phrases like 'generate video', 'make a clip'…" (clipcraft SKILL.md L3) | Multi-line YAML block scalar with description + voice triggers + speech-to-text aliases | Mixed: top-level skill is one Chinese sentence; capabilities range from one-liner Chinese to fragment lists |
| Extra fields | Name + description only ("max 1024 characters") | Name + description only | `version`, `preamble-tier`, `allowed-tools`, `triggers` | None beyond name + description |
| Voice | Third person, technology-agnostic | Third person, domain-specific verbs ("generate", "register", "place") | Third person, includes voice-trigger aliases | Mostly third-person Chinese imperative |

### 1.3 The strongest pattern (recommended for AutoViral)

**Adopt obra's discipline ("Use when X, never workflow") with pneuma's domain richness.** Skip gstack's `version` / `allowed-tools` / `triggers` fields — those are gstack-specific harness metadata, not portable skill conventions.

**Why obra's "no workflow in description" rule wins:** the writing-skills SKILL.md L150-172 explicitly documents a regression they hit: a description that summarized workflow caused Claude to follow the description instead of reading the skill body, doing one code-review pass instead of two. The fix: "description should ONLY describe triggering conditions. Do NOT summarize the skill's process or workflow in the description." This trap applies directly to AutoViral capability docs — if `dreamina-mastery.md`'s description summarizes the "decision tree → model selection → prompt → batch" flow, agents will skim and skip the actual table.

**Why pneuma's domain richness wins inside the description:** pneuma's clipcraft SKILL.md description is 537 chars and packs concrete trigger phrases ("generate video", "make a clip", "add narration", "try another take", "add BGM") that match how users actually phrase requests. obra's "tests are flaky" example is the right shape; pneuma's domain saturation is the right density.

### 1.4 Recommended frontmatter for AutoViral capability docs

```yaml
---
name: <module-prefix>-<kebab-topic>     # e.g. assets-structured-generation
description: 用于 [触发场景列举] 时——例如 [3-5 个具体短语]。包括 [关键约束/边界]。不用于 [明确的反向场景]。
---
```

**Recommended convention:**

1. Keep description ≤ 500 chars (CSO target from writing-skills L102).
2. Open with `Use when…` / `用于…` — triggering conditions only.
3. Include 3-5 concrete trigger phrases drawn from how a user might phrase the request (see pneuma L3 for an exemplary list).
4. End with one line of NEGATIVE space: "不用于 …" / "Don't use for…". This is the obra "what NOT to use" pattern (writing-skills L60-65).
5. **No** version field, **no** allowed-tools field, **no** workflow summary.

**Examples — AutoViral existing capability docs evaluated:**

- `dreamina-mastery.md` L2: `Dreamina CLI 高阶方法论——命令选择决策、模型策略、多模态工作流、批量生产、镜头串联、prompt 工程、异步任务管理、常见问题排查。` — **lists workflow**, violates obra rule. **Suggested rewrite:** `用于使用 dreamina CLI 生成视频/图片时——例如 "用 seedance2.0 生一段视频"、"批量生成关键帧"、"image2video 报错排查"。覆盖命令选择、模型选型、批量提交、参数排错。不用于：非 dreamina 平台（OpenRouter / fal）。`
- `fallback-strategy.md` L3: `受阻时的系统性降级策略——质量优先，最小让步` — **good** (states the trigger), but too short. **Suggested rewrite:** `用于生成或剪辑流程在中途受阻时——例如 "image2video 返回 PROHIBITED_CONTENT"、"API 限流排队"、"ffmpeg 缺少 drawtext"、"输出质量不达标"。给出每种受阻场景的逐级降级路径和告知用户的话术。`
- `quality-gate.md` L3: `素材质量门控模块——生成后自检清单、常见AI生成问题修复策略、美学评分工具参考。在展示生成结果给用户前进行质量评估。` — **good shape**, the closing imperative ("在展示生成结果给用户前进行质量评估") is the right kind of trigger.
- `beat-sync.md` — has **no frontmatter at all**. This is a regression vs. the structure-guide. Fix: add a frontmatter block matching the convention above.

### 1.5 Top-level skill frontmatter

The umbrella `skills/autoviral/SKILL.md` keeps its current frontmatter — that's the entry point that registers the skill in plugin discovery, and the existing description (`AutoViral 创作总技能——中文短视频与图文笔记的一体化创作能力。从情感意图到成片，taste 驱动，模块即能力，用户可从任意起点切入。`) is doing the right thing for that level: it teaches an external reader what the skill IS without describing how to use it.

The capability docs' frontmatter is what governs in-skill load decisions. It needs to be tighter.

---

## 2. SKILL.md structure (umbrella skill)

AutoViral's `skills/autoviral/SKILL.md` is the umbrella entry. It's the "table of contents + manifesto + no procedures" doc. Lessons from the three sources:

### 2.1 obra writing-skills' canonical structure

writing-skills L93-138 prescribes:

```
# Skill Name
## Overview                  — 1-2 sentence core principle
## When to Use               — symptoms; bullet list; "When NOT to use"
## Core Pattern              — before/after for technique skills
## Quick Reference           — table for scanning
## Implementation            — inline code OR link to file
## Common Mistakes           — what goes wrong + fixes
## Real-World Impact         — optional, concrete results
```

That structure is for individual technique/discipline skills, not umbrellas. obra's actual umbrella analogue is `using-superpowers/SKILL.md` — which is a *dispatcher* (priority rules, red-flags table, skill priority order).

### 2.2 pneuma clipcraft SKILL.md structure

pneuma's clipcraft is 376 lines and the closest analogue to AutoViral's umbrella by domain. Its structure:

1. **Domain vocabulary** ("2-minute version") — Asset / Track / Clip / Scene / Provenance / Composition definitions
2. **Making creative decisions** — points at the taste essay (`craft.md`)
3. **Generation scripts** — table of scripts with model + env-var columns (clipcraft SKILL.md L57-65)
4. **Why GPT-Image-2 matters for video work** — model-specific affordance commentary
5. **Sizing images for video (critical)** — pure technical reference table
6. **Calling each script** — concrete bash examples (one canonical example per usage pattern)
7. **Audio layering** — domain gotcha
8. **Typical workflow** — points at `references/workflows.md`
9. **Character consistency** — points at `references/character-consistency.md`
10. **Viewer commands** — context how the skill receives requests
11. **Gotchas** — bullet list of foot-guns
12. **See also** — pointer table to all references

### 2.3 gstack umbrella structure

gstack's top-level SKILL.md mixes two layers: (a) heavy operational preamble (telemetry + upgrade prompts + routing config — ~480 lines), and (b) actual tool documentation (browse subcommands — ~430 lines). The preamble is completely portable-hostile (it shells out to `~/.claude/skills/gstack/bin/gstack-config`). What IS portable:

- A "Routing rules" section that maps user-trigger phrases to skill names (gstack SKILL.md L437-471). AutoViral could adopt a flatter version: a quick "user said X → load module Y" table.
- A `## Voice` section (gstack SKILL.md L367-372): "Direct, concrete, builder-to-builder. Name the file, function, command, and user-visible impact. No filler. No em dashes. No AI vocabulary…" — this is a one-paragraph voice rule that travels with the skill.
- A `## Completion Status Protocol` (gstack L375-381): four return states (`DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`) with required structured-output format. AutoViral has nothing like this.

### 2.4 AutoViral's existing umbrella audit

AutoViral's `skills/autoviral/SKILL.md` already does most of the right things:

- ✅ "起手式：读这三份" — points at three taste docs (mirrors pneuma's `craft.md` link)
- ✅ "任意起点原则" with table of "user said X → enter module Y" (mirrors gstack's routing pattern, lighter)
- ✅ "模块地图" table with pos-tagged columns (本质 / 什么时候用 / 输入 / 输出)
- ✅ "工作流不是线性的" callout with feedback loops (mirrors pneuma's "regenerate variant" workflow)
- ✅ "你拒绝做的事" red-flags list (matches obra's Red Flags pattern)
- ✅ "结构概览" tree at end
- ⚠️ Missing: explicit "Use when…" trigger phrasing — the user-input examples are in a table, not in the description-style "trigger language" form
- ⚠️ Missing: a Voice section (for cross-subagent consistency)
- ⚠️ Missing: a Completion Status Protocol (subagents producing assets / commits / decisions need a standard return shape)
- ⚠️ Missing: a "See also" pointer table to module READMEs (clipcraft has this at the end)

### 2.5 Recommended structure (umbrella SKILL.md)

Rather than rewrite the existing `SKILL.md`, this brief just notes the **gaps** for Phase 2 to optionally close:

1. **Add a `## Voice` section** (8-12 lines): "中文为主，英文术语原样保留。直接、具体、像同行 → 同行：点名文件、命令、模型版本、用户可见的影响。不用 AI 写作词（"鲁棒"、"全面"、"深入挖掘"）。短段落。结尾给下一步动作。" — this travels into capability docs and scripts as a default tone.
2. **Add a `## Completion Protocol` section** mirroring gstack's four states: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT` plus the required `STATUS / REASON / ATTEMPTED / RECOMMENDATION` reporting format. Particularly important for the subagent-driven-development workflow Phase 2 will use.
3. **Add a `## See also` table** at the end mapping each module to its `SKILL.md` plus the most-loaded capability docs in that module — saves a `find` round-trip when a subagent enters fresh.
4. **Leave the rest as-is.** The "任意起点" table, the "拒绝做的事" list, the "你永远在做的事" self-check — these all match the strongest patterns from the three sources and shouldn't be re-litigated.

---

## 3. Capability doc structure (`modules/<module>/capabilities/<topic>.md`)

This is where Phase 2.6 / 2.7 / 2.8 land. The split between the three sources is sharpest here.

### 3.1 The three sources' capability-doc analogues

| Source | "Capability doc" analogue | Scale | Style |
|---|---|---|---|
| obra | Each individual skill IS a capability — they're peers, not nested | 100-700 lines | Discipline-leaning. Heavy on Iron Law, Red Flags, rationalization tables. |
| pneuma | `references/<topic>.md` underneath one skill | 80-700 lines | Reference-leaning. Heavy on worked examples, decision trees, schema docs. |
| gstack | Each individual skill IS a capability with operational scaffolding | 200-900+ lines (most of which is auto-generated preamble) | Tool-leaning. Heavy on bash recipes, command reference tables. |
| AutoViral existing | `modules/<module>/capabilities/<topic>.md` | 100-450 lines | Mostly tool-leaning, some decision-tree-leaning (`fallback-strategy.md`). |

### 3.2 The conflict that needs resolving

**obra**'s capability docs put the rationalization-prevention table near the bottom (writing-skills L498-528 demonstrates this on its own meta-skill). **pneuma**'s reference docs put the **decision tree near the top** and never have a rationalization table at all (`filter-retries.md` is signature-A → recovery; signature-B → recovery; what to do when neither works — no Red Flags section).

The reason for the divergence: obra's skills are *discipline-enforcing* (TDD, verification, design-before-coding); pneuma's references are *operational* (here's the failure mode, here's the recovery). Different shape because different purpose.

**Resolution for AutoViral:** match the document's purpose to its template:

- **Operational capability** (e.g. `dreamina-mastery`, `prompt-mastery`, `frame-gacha`, the new `structured-generation` and `reference-directives`) → pneuma reference shape: decision tree first, recipes second, gotchas third, see-also last. Skip the rationalization table.
- **Discipline / quality capability** (e.g. `quality-gate`, `fallback-strategy`) → obra writing-skills shape: principle, when to use, red flags, rationalization table.
- **Decision-tree / failure-mode capability** (e.g. the new `filter-retries`) → pneuma's `filter-retries.md` shape: signature → recovery, with explicit "when neither works" escape hatch.

Three templates, not one. AutoViral's existing capability docs already split this way intuitively — `dreamina-mastery.md` is operational (decision tree → tables → bash); `fallback-strategy.md` is discipline (principle → levels → ❌ wrong patterns). Phase 2 just needs to pick the right template per task.

### 3.3 Recommended sections — operational template

```markdown
---
name: <module>-<topic>
description: 用于 [3-5 触发短语]。覆盖 [边界]。不用于 [反向]。
---

# <Title>

<1-2 段落：本能力解决什么问题、什么时候触发、与同 module 其他能力的边界>

## 决策树 / 命令选择
<这是 pneuma "Workflow 0..5" 的 AutoViral 化等价物——
 用 ASCII 树或表格回答 "面对 X 输入，调哪个工具/参数"。最重要的一节，放最上面>

## 关键参数 / Quick Reference 表
<≤ 5 列的表格，可扫读。pneuma 的"Composition-to-image-size cheat sheet" 是范本>

## 工作流（一两个 canonical example）
<1-2 个完整的 bash + JSON 端到端例子。pneuma SKILL.md L139-174 是标准长度——
 4-6 个 example，每个 8-15 行 bash，覆盖典型变体（基础 / 编辑 / 多图 / 备用模型）>

## 与其它能力的衔接
<列举：和同 module 哪些 capabilities 联动，和 taste/ 哪条规则呼应。
 dreamina-mastery L380-430 的 "与 assembly 模块"、"与首帧生成的衔接" 是范本>

## Gotchas
<5-10 条短句的踩坑列表。pneuma SKILL.md L350-365 是范本——
 每条一句话 + 一句解释>

## See also
<指向同 module 的相关 capabilities，和 taste/ 的相关章节>
```

### 3.4 Recommended sections — discipline template

```markdown
---
name: <module>-<topic>
description: 用于 [3-5 触发短语]——例如…。不用于…。
---

# <Title>

## 核心原则
<1-3 句的核心信仰。obra L8-14 是范本：
 "Writing skills IS Test-Driven Development applied to process documentation."
 一句话 + 一句注脚>

## Iron Law / 不可妥协的事
<显式禁令。obra L31-46 范本：
 "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
  Write code before the test? Delete it. Start over."
 AutoViral 等价物：fallback-strategy 的 "❌ 错误：静默退化到 text2video"。
 关键：禁令要点名具体的反模式，不能笼统说 "保持质量"。>

## When to Use / When NOT to Use
<两段对照。"什么时候是" + "什么时候不是" 同样重要——
 fallback-strategy 缺了 "什么时候不是"，应该补>

## 决策表 / 降级路径
<表格或编号清单。fallback-strategy 已有的 1-6 编号场景就是这个>

## Red Flags — STOP and Reconsider
<obra writing-skills L510-525 范本——
 列出 "这些念头出现 = 你正在违反原则"。
 例如对 fallback-strategy："静默换模型"、"用户没问就跳到 text2video"、
 "这次特殊不告知"——立刻停下>

## 常见 Rationalization 表
<obra L498-507 范本——左列借口、右列现实。
 AutoViral 等价：
 | 借口 | 现实 |
 | "都已经生了 5 次了，将就一下" | 沉没成本谬误。该重做就重做。 |
 | "用户没明确要求，省略告知" | 静默降级 = 偷换合同。一定要告知。|
 >

## See also
```

### 3.5 Recommended sections — failure-mode template

```markdown
---
name: <module>-<topic>
description: 用于 [API X 报错时]——例如 "PROHIBITED_CONTENT"、"422 image_urls"、"safety_filter_triggered"。给出按错误签名分发的恢复路径。
---

# <Title>

## 总览
<2-3 句：有几个不同的失败签名、它们成因不同、不要瞎试>

## Signature A — <错误名>
**What you see:**
<原文 stderr / API response 的逐字摘录。pneuma filter-retries.md L17-28 是范本——
 直接贴 JSON，标出关键 token>

**What it means:** <一句话因果>

**Recovery:**
<编号步骤。pneuma L36-67 是范本——
 1. 识别问题来源
 2. 跑哪个修复脚本（含 bash）
 3. 替换什么参数
 4. 哪些 prompt 词必须删除
 5. 重试时还要加什么 flag>

**Do NOT use this workflow for:** <负面清单>

## Signature B — <错误名>
<同上>

## When neither recovery gets you through
<逃生通道。pneuma L110-130 范本——
 包括 "硬限制何时浮出给用户"、"什么时候停止重试"、"备用模型成本和限制">
```

### 3.6 Density rule of thumb

- **< 100 lines** → likely missing worked examples. Refer to pneuma's average (272-700 lines per reference doc).
- **100-400 lines** → sweet spot for an operational capability. AutoViral's existing `dreamina-mastery.md` (430 lines) sits at the upper end and reads fine.
- **> 700 lines** → almost certainly trying to do two things. Split.

For the Phase 2 templates below: Section 7's targets are **structured-generation: ~200 lines, reference-directives: ~150 lines, filter-retries: ~250 lines**.

---

## 4. Reference doc structure (`modules/<module>/references/<topic>.md`)

The capability vs. reference split is non-trivial. AutoViral's `docs/skill-structure-guide.md` says:

> 每个模块的 capabilities/ 子目录放扩展能力文档（按需加载），references/ 放平台技术规格

That's a useful first cut, but pneuma's actual practice complicates it — pneuma keeps everything under `references/` (no `capabilities/` directory), and the references contain a mix of pure-spec docs (`project-json.md`, `asset-ids.md`) and operational-tactic docs (`workflows.md`, `filter-retries.md`).

### 4.1 The split that actually works

Apply this rule consistently:

| Goes in `capabilities/` | Goes in `references/` |
|---|---|
| Decision-tree docs ("which command for input X") | Pure tech spec ("seedance allowed durations: 4 / 6 / 8 sec") |
| Worked examples / recipes | API endpoint cheatsheets |
| Failure-mode taxonomies | Schema documentation (Zod / JSON Schema dumps) |
| Quality / discipline rules | Platform constraints (aspect ratios, file size limits, codec lists) |
| Cross-tool composition patterns | Genre-specific style codices (because they're stable spec, not operational) |
| **Anything that reads like "how to think about X"** | **Anything that reads like "what X allows / requires"** |

### 4.2 What goes where in Phase 2

For tasks 2.6 / 2.7 / 2.8 specifically:

- **2.6 `structured-generation.md`** → `capabilities/` — it's a "how to interpret a viewer-dispatched JSON envelope and translate it into script invocation + provenance". Decision flow + worked example.
- **2.7 `reference-directives.md`** → `capabilities/` — it's the role-vocabulary system + worked-example pattern from pneuma's `reference-directives.md`. Decision tree + recipe density.
- **2.8 `filter-retries.md`** → `capabilities/` — it's a failure-mode taxonomy. Same reason pneuma kept it in `references/` is just because pneuma uses references/ as its only storage; the *content* is operational, not spec.

**What stays in `references/`** for the assets module: existing `references/<platform>.md` files (Dreamina, OpenRouter, fal.ai endpoint specs), the eventual `references/seedance-error-envelopes.md` if the team decides to dump the actual error JSON corpus into a fixtures-style doc.

### 4.3 references/ doc shape

References should be terse, scannable, and cite-able. Pneuma's `asset-ids.md` (80 lines, naming rules + examples) and `project-json.md` (195 lines, schema with field-level annotations) are the model.

```markdown
---
name: references-<platform-or-spec>
description: <Platform/spec> 的技术规格速查表。仅技术约束，不含创作建议。
---

# <Platform / Spec name>

<1-2 段：这份文档的边界——什么进、什么不进>

## <Spec sub-area 1>
| Field / Param | Allowed values | Notes |
|---|---|---|

## <Spec sub-area 2>
<short text + table>

## Errors / Failure modes
<list of signatures, link out to capabilities/<failure-doc> for recovery>

## See also
<link to capabilities/ docs that USE this reference>
```

The key rule from CLAUDE.md, repeated: **"references/ 只写技术规格，不写创作建议"**. If a reference doc says anything resembling "this platform performs better with cuts every 0.5s," that line belongs in `taste/` (or in `capabilities/` if it's a tactical recipe). References stay sterile.

---

## 5. Script structure (`modules/<module>/scripts/<name>.py`)

Phase 2.9 / 2.10 are Python scripts. The reference shape is pneuma's `make-character-sheet.mjs` (171 lines, Node) — but the Python equivalent should preserve all its key structural decisions while adapting to Python idioms.

### 5.1 What pneuma's make-character-sheet.mjs gets right

Reading `/tmp/pneuma-skills/modes/clipcraft/skill/scripts/make-character-sheet.mjs` line-by-line, the patterns worth copying:

1. **Doc-block first** (L1-49). Multi-line `/** … */` comment that documents:
   - What the script does (one paragraph)
   - When the agent should call it ("after `generate-video.mjs reference` rejects…")
   - When NOT (does not auto-invoke from inside generate-video.mjs)
   - Sheet layout / output shape (the panel-by-panel description IS in the doc-block)
   - Usage example with full bash invocation
   - Each flag's semantics (`--source-url required, local or http(s) URL…`)
   - Required environment variables (`FAL_KEY — required; fal.ai API key`)

2. **Imports + constants block** (L51-64). Single endpoint URL constant, MIME table.

3. **Pure helper functions** (L65-87): `mimeFromPath`, `resolveSourceUrl` (handles http(s) vs local file inline), `csvToList`, `buildPrompt`. Each one is small, testable, single-purpose.

4. **Prompt as a structured array, joined with newlines** (L86-102). The 4-panel prompt is built as `[para1, "", para2, "", …].join("\n")` — making each panel description editable as a single string, with whitespace explicit. This is hugely better than templating into one giant string.

5. **API-call helper** (L104-124): single async function `falEdit`, single `if (!res.ok) throw new Error(`<service> failed (${status}): ${body}`);` shape — the exact error format the agent will pattern-match on later.

6. **Download helper** (L126-132): downloads URL, writes bytes to disk, ensures parent dir exists.

7. **`die(msg)` exit pattern** (L134-137): single function for "log to stderr and exit 1". Used everywhere instead of throws scattered in main flow.

8. **`parseArgs` from `node:util`** (L139-148). Whitelist of flag names, all `type: "string"`, no positionals allowed. Schema-driven argument parsing.

9. **Main flow as a flat top-level try/catch** (L150-170): env check, arg validation, build prompt, call API, download, log path, single catch that calls `die`.

10. **Stdout = the output path, single line, exit 0**. Stderr = errors. This is the contract clipcraft SKILL.md L73 names: `"the other four follow the older flag-based convention where --output <path> is required and stdout is just the output path."`

### 5.2 What AutoViral's existing scripts already do well

Reading `modules/assets/scripts/openrouter_generate.py` L1-220:

- ✅ Module-level docstring with usage examples (L1-27)
- ✅ Multiple `.env` discovery roots with priority order (L65-114) — better than pneuma which only reads `process.env`
- ✅ `argparse` with explicit dest names
- ✅ Helper functions split out: `load_env`, `get_api_key`, `extract_image_data`, `extract_text_content`, `generate_image`
- ✅ Constants block with `OPENROUTER_URL`, `DEFAULT_MODEL`, `ASPECT_RATIO_PIXELS`, `VALID_IMAGE_SIZES`
- ✅ Module-level `# ── 段标 ──` comments to delimit sections (L39, L67, L128, L200) — quirky but readable

What's missing vs. pneuma:

- ⚠️ No "When agent should call this / when NOT" section in the docstring. AutoViral scripts assume the agent will figure that out from context — but Phase 2's structured-generation flow specifically benefits from "this script is the recovery for filter signature A; do not call it for signature B".
- ⚠️ No prompt-as-structured-array pattern. The prompt construction in `openrouter_generate.py` is opaque — when prompts are part of the contract (filter-retry templates), they should be readable and editable as discrete blocks.
- ⚠️ No standardized `<service>-name failed (<status>): <body>` error format. Each script throws differently.
- ⚠️ Inconsistent stdout contract. Some scripts print JSON, some print path, some print log noise. The pneuma rule of "stdout is just the output path; stderr is everything else" should be unified.

### 5.3 Recommended Python script template

```python
#!/usr/bin/env python3
"""
<Script title — one short clause>

<2-3 段 paragraph describing:
  - What this script does (verb-first)
  - When the agent should call it
  - When the agent should NOT call it
  - What success looks like (output file shape, stdout contract)>

This is a <manual recovery tool / generator / preprocessor> the agent
calls after <triggering condition>. It is NOT automatically invoked
from <inside another script>. The agent is expected to read <doc>,
decide this tool is appropriate, run it, and re-invoke <next step>.

Usage:
    python3 <script>.py \\
        --required-flag <value> \\
        [--optional-flag <value>] \\
        --output <path>

Flags:
    --required-flag    required. <Description>.
    --optional-flag    optional. Defaults to <default>. <Description>.
    --output           required. Workspace-relative path for the result.

Environment:
    AUTOVIRAL_PROJECT_DIR — optional; project root for .env discovery
    OPENROUTER_API_KEY    — required; OpenRouter API key
    FAL_KEY               — required if --provider=fal
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

import requests

# ── Constants ────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-5.4-image-2"

# ── .env loading (shared pattern, copy from openrouter_generate.py) ──

def load_env() -> dict[str, str]:
    """Search AUTOVIRAL_PROJECT_DIR, ~/.autoviral, script dir, cwd up."""
    # ... (lift verbatim from openrouter_generate.py L65-114) ...

def get_api_key(env_var: str, hint: str) -> str:
    key = os.environ.get(env_var, "") or load_env().get(env_var, "")
    if not key:
        die(f"[error] {env_var} not set ({hint})")
    return key

# ── Helpers ──────────────────────────────────────────────────────────

def die(msg: str) -> None:
    """Log to stderr and exit non-zero. Single chokepoint for failures."""
    print(msg, file=sys.stderr)
    sys.exit(1)

def build_prompt(args) -> str:
    """Build the prompt as an array of discrete paragraphs joined with \\n.

    Why this shape: when the prompt is part of the contract (e.g. a
    filter-retry template), each paragraph should be editable in
    isolation. Don't template into one giant f-string.
    """
    return "\n".join([
        "Paragraph 1: <description>",
        "",
        f"Paragraph 2: includes {args.some_flag}.",
        "",
        "Paragraph 3: <description>",
    ])

# ── API call ─────────────────────────────────────────────────────────

def call_provider(prompt: str, *, api_key: str, image_url: str | None) -> dict:
    """Single async-equivalent function. Single error format on failure."""
    res = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": DEFAULT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            # …
        },
        timeout=180,
    )
    if not res.ok:
        die(f"openrouter call failed ({res.status_code}): {res.text}")
    return res.json()

# ── Main ─────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--required-flag", required=True, help="...")
    parser.add_argument("--optional-flag", default=None, help="...")
    parser.add_argument("--output", required=True, help="Output file path")
    return parser.parse_args()

def main() -> None:
    args = parse_args()
    api_key = get_api_key("OPENROUTER_API_KEY", "set in .env or environment")
    prompt = build_prompt(args)
    result = call_provider(prompt, api_key=api_key, image_url=None)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # ... write bytes ...
    print(str(output_path))  # stdout = output path; nothing else

if __name__ == "__main__":
    main()
```

### 5.4 The contracts the implementer must hold

| Contract | Why |
|---|---|
| stdout = single line: the output file path | Lets the agent capture it with `path=$(python3 …)` and use it as the next step's input. AutoViral existing scripts violate this inconsistently. |
| stderr = everything else (logs, errors, debug) | Lets the agent grep stderr for known error signatures (the basis of filter-retry detection). |
| exit 0 on success, non-zero on failure | TDD-friendly. |
| `<service> <verb> failed (<status>): <body>` error format | Pattern-match-able. Filter-retry signature detection depends on this exact shape. |
| `--help` covers all flags with the doc-block in `description=__doc__` | Discoverability without reading source. |
| Required env vars listed in the doc-block, validated via `die("X not set")` | No surprise mid-run failures. |
| Prompt construction as `[paragraph_str, ...].join("\n")` when prompt is part of the contract | Editable in isolation, diffable. |
| `Path(args.output).parent.mkdir(parents=True, exist_ok=True)` before writing | No "directory does not exist" errors. |

### 5.5 Where AutoViral diverges from pneuma — and shouldn't change

- **Python over Node.** AutoViral's tooling layer is Python (`librosa`, `whisper`, `mediapipe`, `numpy`, `Pillow`); keep it Python. The patterns transfer 1:1.
- **`load_env` with multiple search roots.** AutoViral runs from a server context where `AUTOVIRAL_PROJECT_DIR` is injected; pneuma assumes a single workspace. AutoViral's existing pattern (L65-114 of `openrouter_generate.py`) is correct — keep it.
- **`requests` over `fetch`.** Native to Python.
- **No top-level `await`.** Python doesn't need it. Synchronous main flow with `requests` is fine for these scripts (single API call → write file).

---

## 6. Cross-doc cross-referencing

A small but high-impact decision: how does docs A reference doc B?

### 6.1 The three sources' patterns

| Source | Pattern | Example |
|---|---|---|
| obra | `superpowers:<skill-name>` for sibling skills, `@filename` for force-load (DISCOURAGED — burns context), bare relative path for "see this file" | "REQUIRED SUB-SKILL: Use `superpowers:test-driven-development`" (writing-skills L18) |
| pneuma | Bare relative path: `references/craft.md`, `references/project-json.md` | "Schema in `project-json.md`; id rules in `asset-ids.md`." (clipcraft SKILL.md L8) |
| gstack | Slash-prefixed skill name: `/qa`, `/investigate`, `/ship` (because gstack registers skills with slash prefixes) | "User reports a bug → invoke `/investigate`" (gstack SKILL.md L445) |
| AutoViral existing | Mixed: `taste/00-prime-directive.md`, `modules/assets/`, `references/module-contracts.md` | "1. **`taste/00-prime-directive.md`** — 你的创作信仰" (skills/autoviral/SKILL.md L21) |

### 6.2 The mismatch between obra and pneuma

obra writing-skills L286 explicitly bans `@`-style paths because they force-load files into context immediately. obra prefers `superpowers:<skill-name>` because the skills system understands that as a *reference*, not an inclusion. **But** obra also does plain relative paths inline (e.g. its own `@graphviz-conventions.dot` reference at L316 — note the inconsistency).

pneuma uses plain relative paths everywhere — works because pneuma is a self-contained skill where every doc is in the same tree.

### 6.3 Recommended canonical form for AutoViral

Adopt **plain relative paths** as the canonical form (matches pneuma, matches AutoViral's existing usage):

```markdown
✅ See `taste/06-rubric.md` for the 8-dimension scoring rubric.
✅ Recovery flow in `capabilities/filter-retries.md`.
✅ Schema reference at `references/openrouter-api.md`.
✅ Script: `scripts/make_character_sheet.py`.
```

**Why** plain paths and not slash-prefixed names like `/filter-retries`:
- AutoViral isn't registering individual capabilities as separately-invokable skills.
- The whole umbrella IS the skill; capabilities load into the same context.
- Plain paths mirror how a user `find`s the file in the repo.

**Forbid** the `@filename` syntax for cross-doc references:
- ❌ `@references/filter-retries.md` — would force-load and burn context.

**Forbid** the `superpowers:<name>` syntax inside AutoViral docs:
- ❌ `superpowers:test-driven-development` — that's a different plugin's namespace; not portable.
- Exception: when AutoViral's docs explicitly reference an external superpowers skill (e.g. the master plan does this in its preamble), use the namespaced form.

**Path format:**
- Always relative to the **doc's own location**, not skill root.
- Example: `modules/assets/capabilities/structured-generation.md` referring to a sibling capability uses `filter-retries.md` (same dir), not `modules/assets/capabilities/filter-retries.md`.
- Cross-module references: `../assembly/capabilities/beat-sync.md` from inside `modules/assets/capabilities/`.

**The "See also" footer** should be a table or short list at the bottom of every capability doc. pneuma's clipcraft SKILL.md L367-376 is the model:

```markdown
## See also

- `references/craft.md` — the craft of short video: principles over procedures
- `references/project-json.md` — full `project.json` schema
- `references/workflows.md` — three end-to-end worked examples
```

For AutoViral, this becomes:

```markdown
## See also

- `taste/06-rubric.md` — final quality gate
- `capabilities/filter-retries.md` — recovery flow when this script gets blocked
- `references/openrouter-api.md` — OpenRouter request/response shape
- `scripts/make_character_sheet.py` — sibling recovery tool
```

---

## 7. Worked examples — Phase 2 specific templates

Each template below is what the implementer should *start* with, not finish with. The implementer fills in [BRACKETED] placeholders with concrete content drawn from the codebase, the actual API responses, and any fixtures the team provides.

### 7a. Template for `modules/assets/capabilities/structured-generation.md` (Phase 2.6)

**Type:** Operational capability (decision tree → recipes → gotchas).
**Target length:** ~200 lines.
**Mirrors:** pneuma `clipcraft/skill/references/workflows.md` Workflow 5 (the structured-notification handler), AutoViral master plan §2 phase 2 task 2.6.

```markdown
---
name: assets-structured-generation
description: 用于处理 viewer 派发的结构化生成请求时——例如 "[autoviral:create-asset] 创建图片"、"[autoviral:generate-variant] 重生成视频"、"[autoviral:edit-asset] 修改首帧"。给出 JSON envelope 解析规则、脚本调度、provenance 注册流程。不用于：自由对话中的生成请求（直接调用对应模块即可，无需该 envelope 协议）。
---

# 结构化生成请求处理

[1-2 段：什么是 structured-generation envelope（来自 viewer，不是用户自然语言）；
 和 freeform 的区别；为什么需要逐字段解析而非"理解意图"]

## Envelope 协议

[envelope 的 4 个 mode：create-asset / generate-variant / edit-asset / refine-asset]
[每个 mode 的必填字段表格 — kind / prompt / params / script / provenance_hint]
[一个完整的 JSON 例子，标记每个字段的语义]

## 处理流程（不是顺序流程，是分支流程）

```
收到 envelope
  ↓
解析 JSON block（忽略人类摘要行）
  ↓
分支：mode 是什么？
  ├── create-asset   → fromAssetId = null,  operation.type = "generate"
  ├── generate-variant → fromAssetId = source.asset_id, operation.type = "derive"
  ├── edit-asset     → fromAssetId = target.asset_id, operation.type = "edit"
  └── refine-asset   → fromAssetId = source.asset_id, operation.type = "refine"
  ↓
[选 stable semantic id（参考相邻 assets，不要 UUID）]
  ↓
[选 output 路径（assets/{kind}/{semantic-name}.{ext}）]
  ↓
[调用 script — 字面套用 envelope 的 script + script_args]
  ↓
[注册 asset — id / type / uri / metadata（仅物理属性）/ createdAt / status]
  ↓
[追加 provenance edge — 严格按 provenance_hint 填，不允许擅自改 type/from]
  ↓
[不要自动放上 timeline — viewer 会让用户单独决定]
  ↓
返回 locator 卡片
```

## Worked example 1 — create-asset（图片）

[完整的 envelope JSON 例子]

[Step 1: 解析 — 列出抽出的字段]
[Step 2: 选 id / 选路径]
[Step 3: 调脚本 — 完整的 python3 调用]
[Step 4: 注册 — 完整的 assets[] entry JSON]
[Step 5: provenance — 完整的 edge JSON]
[Step 6: 返回给用户的话术]

## Worked example 2 — generate-variant（视频）

[关键差异：fromAssetId 必须指向 source、operation.type 必须是 "derive"]
[envelope JSON 例子]
[逐字段映射到 provenance]

## 不要做的事

- ❌ 不要重写 prompt — 字面传给 script
- ❌ 不要混合 mode — create-asset 不能产生 derive provenance
- ❌ 不要省略 provenance_hint 字段 — 即使值是 null
- ❌ 不要把 envelope JSON 复读给用户（他们填的表，知道自己填了什么）
- ❌ 不要自动 add clip — timeline 放置是用户的决定
- ❌ 不要重命名 envelope 里的 script_args（viewer 的 intent 必须忠实传递）

## Gotchas

- **createdAt 必须稳定**——同一 asset 多次 hydrate 共享 createdAt，不要每次重写时刷新
- **uri 在 generating 状态可以为空字符串**——脚本完成后再写
- **operation.timestamp 必须 == asset.createdAt**——hydration 依赖
- **kind 字段决定文件子目录**：image → assets/image/，video → assets/video/，audio → assets/audio/
- **prompt 是 positional 还是 flag 取决于 script**——envelope 的 script_args 已经替你决定了，不要二次猜测
- [其余 5-8 条从实际开发踩坑中提取]

## See also

- `capabilities/filter-retries.md` — script 报错时的恢复路径
- `capabilities/reference-directives.md` — variant 模式下 reference 角色分配
- `references/locator-card-shape.md` — 返回给 user 的卡片格式
- `scripts/openrouter_generate.py` — image 路径的脚本
- `scripts/jimeng_generate.py` — video 路径的脚本
```

### 7b. Template for `modules/assets/capabilities/reference-directives.md` (Phase 2.7)

**Type:** Operational capability (vocabulary + addressing + worked example).
**Target length:** ~150 lines.
**Mirrors:** pneuma `clipcraft/skill/references/reference-directives.md` (131 lines) — almost direct port, adapted from seedance-2.0/reference-to-video to Dreamina seedance / OpenRouter gpt-5.4-image-2 edit mode.

```markdown
---
name: assets-reference-directives
description: 用于多参考图/参考视频驱动生成时——例如 "用 image1 的人物替换 video1 中的角色"、"参考 image2 的环境作为目的地"、"用 video1 的运镜配 image1 的角色"。给出 @addressing 语法、role 词汇、合法槽位预算。不用于：单图驱动（直接 image2video / from-image 即可）。
---

# Reference-driven 生成 — directive 语言

[1-2 段：reference 模式的本质——不是"多张图当 identity"，而是"每张参考图分配一个结构化角色"。
 最常见的失败 = 把 reference 当 from-image 多塞几张图。]

## @addressing 语法

[Dreamina multimodal2video 和 seedance-2.0/reference-to-video 的 @ 地址方案：
 - @image1, @image2 ... 按 --image-url 出现顺序 1-indexed
 - @video1 ... 按 --video-url 出现顺序，独立编号
 - @audio1 ... 按 --audio-url 出现顺序
 - 未被 @ 引用的 ref 几乎被忽略]

```bash
[一个完整的 dreamina multimodal2video 调用，代码注释标注每个 ref 是 @imageN]
```

## Role 词汇表

| Role | 中文模式 | English pattern | 它做什么 |
|---|---|---|---|
| 角色身份 | "@image1 中的人物"、"用 @image1 替换 @video1 的角色" | "the character from @image1" | 锁定主体外观 |
| 首帧锚定 | "以 @image1 作为开场画面" | "with @image1 as the first frame" | 视频开场即匹配该 ref |
| 目的环境 | "进入 @image2 所示的环境" | "travel to the environment of @image2" | 视频结束位置 |
| 中景设置 | "在 @image2 的场景中" | "in the location shown in @image2" | 全程发生在该环境 |
| 运镜传递 | "参考 @video1 的运镜节奏" | "refer to the camera movement of @video1" | 借用 dolly/tracking |
| 风格迁移 | "用 @image3 的视觉风格" | "in the visual style of @image3" | 借色彩/质感 |
| 道具/服装 | "角色应戴 sci-fi 眼镜" | "the character should wear ..." | 增加细节 |
| 视角切换 | "从第三人称切到第一视角" | "from third-person to subjective POV" | 镜头语言 |
| 音频床 | "以 @audio1 作为背景音乐" | "background music from @audio1" | 需要不加 --no-audio |

## Worked example — 角色穿越科幻序列

[完整的 dreamina multimodal2video bash 调用，
 mirror pneuma reference-directives.md L65-77，
 但用 dreamina CLI 语法（--image, --video）而非 pneuma 的 --image-url]

[每个 ref 对应做的事用注释标注：
 # @image1: 角色身份 + 首帧锁定
 # @image2: 目的地环境
 # @video1: 运镜模板（替代冗长 camera prose）]

[关键观察：每个 ref 的角色不重叠 → 模型能干净地 follow]

## 槽位预算

| 类型 | 上限 | 备注 |
|---|---|---|
| --image | 9 | dreamina multimodal2video |
| --video | 3 | dreamina multimodal2video |
| --audio | 3 | dreamina multimodal2video，需要至少一个 image/video ref 才能用 |
| 总计 | ≤ 12 | 包括所有模态 |

[槽位策划建议——
 - 角色 ref：除非角色需要多角度，1 张就够
 - 视频 ref：当运镜/节奏比"看"更重要时，5 秒视频 > 三段 prompt
 - 音频 ref：稀有用——content-policy 经常打回，--no-audio 是默认安全调用]

## reference vs image2video vs text2video

[决策表 mirror pneuma L113-122]

## See also

- `capabilities/dreamina-mastery.md` — multimodal2video 完整命令矩阵
- `capabilities/character-consistency.md`（如果决定建）— 真人 ref 的特殊处理
- `capabilities/filter-retries.md` — content-policy 报错恢复
```

### 7c. Template for `modules/assets/capabilities/filter-retries.md` (Phase 2.8)

**Type:** Failure-mode taxonomy (signature → recovery, escape hatch).
**Target length:** ~250 lines.
**Mirrors:** pneuma `clipcraft/skill/references/filter-retries.md` (129 lines) directly — but the actual signatures need fixtures from the AutoViral team because Dreamina / OpenRouter / fal error envelopes are NOT identical to seedance-2.0's.

> **CRITICAL FOR THE IMPLEMENTER:** Before writing this doc, REQUEST FIXTURES from the team. Specifically you need:
>
> 1. **Dreamina image2video filter rejection sample** — the actual stderr / response body when content policy blocks
> 2. **Dreamina text2video PROHIBITED_CONTENT response** — the AutoViral fallback-strategy.md L17 mentions this exists
> 3. **Dreamina AigcComplianceConfirmationRequired response** — already documented in dreamina-mastery.md L335 but the actual JSON is not in the codebase
> 4. **OpenRouter gpt-5.4-image-2 safety_filter response** — the multi-key envelope OpenAI returns
> 5. **fal.ai nano-banana / seedance-2.0 422 responses** — if AutoViral wraps these
>
> Without real fixtures, the signatures in this doc will be guessed, and signature-matching is a contract — it has to match the actual `loc:` and `reason:` keys verbatim.

```markdown
---
name: assets-filter-retries
description: 用于生图/生视频脚本被内容审核拒绝时——例如 dreamina 返回 PROHIBITED_CONTENT、OpenRouter safety_filter_triggered、fal partner_validation_failed、AigcComplianceConfirmationRequired 字样。给出按错误签名分发的恢复路径。不用于：网络错误、超时、积分不足（参见 fallback-strategy.md）。
---

# Content-Filter 重试决策树

[2-3 段：
 - 不同 provider 的拒绝消息形态不同，看着像但成因不同
 - 重写 prompt 不能 defeat 所有拒绝（图侧拒绝完全不读 prompt）
 - 决定恢复路径前必须先 match signature]

## Signature index — 速查

| 看到关键 token | Signature | 哪个 provider | 恢复路径 |
|---|---|---|---|
| `loc:["body","image_urls"]` + `partner_validation_failed` | A | fal seedance-2.0 reference | §A：换 character sheet |
| `loc:["body","generated_video"]` + `Output audio has sensitive content` | B | fal seedance-2.0 | §B：加 --no-audio |
| `PROHIBITED_CONTENT` + image2video / text2video | C | dreamina | §C：改 prompt + 换模型 |
| `AigcComplianceConfirmationRequired` | D | dreamina seedance2.0 首次使用 | §D：网页授权 |
| `safety_filter_triggered` | E | OpenRouter gpt-5.4-image-2 | §E：改 prompt or 换模型 |
| [更多签名待 fixtures 提供] | … | … | … |

## Signature A — fal 图侧拒绝（人脸 ref）

**What you see:**
```
[贴入 fixture 提供的真实 stderr / response body]
```

**Key tokens to match:** `loc:["body","image_urls"]` and `reason:"partner_validation_failed"`.

**What it means:** [一句话因果——图分类器在 ref 里检出真人脸，prompt 完全没读。]

**Recovery:**

1. [识别哪一张 --image-url 含真人脸（通常是 character ref）]
2. [跑 character sheet 脚本——填具体命令]
   ```bash
   python3 skills/autoviral/modules/assets/scripts/make_character_sheet.py \
     --source-url <被拒的图> \
     --outfit "..." \
     --traits "..." \
     --output assets/image/character-sheet-<name>.jpg
   ```
3. [用 sheet 替换原 ref 重新调用]
4. [必须删除 prompt 中的 "虚拟数字角色"、"virtual character"、"CG render" 等 — 这些词 defeat 不了 filter，反而把模型推向 game-CG aesthetic]
5. [加 --no-audio（Signature B 经常在重试时浮出）]

**Do NOT use this workflow for:**
- 真人照片（你没拿到肖像授权的）
- 任何形式的未成年照片（AI 生的也不行）
- 已经是 stylized / 3D / 动漫 风格的 ref（这些直接过 filter）

## Signature B — fal 输出音频拒绝

**What you see:**
[贴入 fixture]

**Key tokens to match:** `loc:["body","generated_video"]` and `msg:"Output audio has sensitive content."`

**What it means:** [图过了，帧已经生了，自动音频被音频分类器打回]

**Recovery:**
1. 完全相同的命令重试，加 --no-audio
2. 不改 prompt、不改 seed、不改任何其它参数

[character-heavy prompt 经常碰到——可以默认带 --no-audio 跳过第一轮失败]

## Signature C — dreamina PROHIBITED_CONTENT

**What you see:**
[贴入 fixture]

**Key tokens:** [按 fixture 决定]

**What it means:** [按 fixture 决定]

**Recovery:**
[逐级降级，参考 fallback-strategy.md §1：
 Level 1: 改 prompt 去敏感词（保留 image2video 命令）
 Level 2: 换模型 seedance2.0 → 3.0
 Level 3: 告知用户三选一]

## Signature D — dreamina AigcComplianceConfirmationRequired

**Recovery:**
1. [打开 https://jimeng.jianying.com，登录同账号]
2. [找到该模型完成授权]
3. [重试 CLI]
[这是一次性人工动作，不要反复重试。dreamina-mastery.md L335-340 是来源]

## Signature E — OpenRouter gpt-5.4-image-2 safety filter

**What you see:**
[贴入 fixture — 通常是 message.content 中的拒绝文本]

**What it means:** [OpenAI 的 prompt-side safety classifier 拦的。和 fal 的 image-side 不同，这个 IS 读 prompt 的]

**Recovery:**
1. [改 prompt 去除可能 trigger 的 token]
2. [如果是必要题材，换 jimeng / fal 走另一条路]

## When neither recovery gets you through

[逃生通道——
 - Signature A 多次尝试仍失败 → sheet 还含真人脸；编辑 sheet 把脸换成铅笔素描
 - 跨多次 sheet 迭代仍失败 / ref 必须像特定真人 → 升级给用户、不要绕过身份保护
 - Last resort：换备用 provider（dreamina ↔ fal ↔ OpenRouter 之间路由）]

## See also

- `capabilities/character-consistency.md`（如果决定建）— sheet 制作详细流程
- `capabilities/fallback-strategy.md` — 非 content-filter 的降级路径
- `scripts/make_character_sheet.py` — Signature A 的恢复脚本
- `scripts/filter_retry/detect_signature.py` — Signature 自动分发（Phase 2.10）
- `references/<provider>-error-envelopes.md` — 完整错误响应字典（如果决定建 references/）
```

### 7d. Template for `modules/assets/scripts/make_character_sheet.py` (Phase 2.9)

**Type:** Python recovery script (deterministic, single-purpose).
**Target length:** ~180-220 lines.
**Mirrors:** pneuma `make-character-sheet.mjs` directly — same prompt verbatim, same `--source-url / --outfit / --traits / --output` interface, same stdout=path contract. The ONLY thing that changes: the API client.

> **What to keep verbatim from pneuma:**
> - The 4-panel sheet description (Panel 1 / Panel 2 / Panel 3 / Panel 4 with the typewriter `OUTFIT` / `CHARACTER` block)
> - Why-this-tool-exists doc-block paragraph
> - "Manual recovery tool — NOT automatically invoked" warning
> - Default behavior when --outfit / --traits are omitted (read from source image)
>
> **What to change:**
> - API client: pneuma calls `https://fal.run/fal-ai/nano-banana-2/edit`. AutoViral should call OpenRouter's `gpt-5.4-image-2` edit mode (already wrapped in `openrouter_generate.py` — DO NOT duplicate; import or call out).
> - Auth: `FAL_KEY` → `OPENROUTER_API_KEY` (with the existing `load_env()` helper).
> - Prompt: keep verbatim, but the model handles edit-with-reference differently — verify the multi-image input path matches.

```python
#!/usr/bin/env python3
"""
AutoViral Character Sheet Generator

Produces a 16:9 "photo-body, sketch-head" character reference sheet
from a single source image. The sheet shape is verified to pass
seedance / dreamina image-side content filters for photorealistic
AI-generated human characters.

This is a **manual recovery tool** the agent calls after a
reference-driven generate call rejects an image with content_policy
violations targeting the image_urls field. It is NOT automatically
invoked from inside any other script. The agent is expected to read
`capabilities/filter-retries.md`, decide this tool is appropriate,
run it, and re-invoke the original generate command with the
resulting sheet.

Sheet layout (4 tall vertical panels on black, 16:9 overall):
  Panel 1 — photographic front view full body, head as pencil sketch
  Panel 2 — photographic left-profile side view, head as pencil sketch
  Panel 3 — photographic back view, hair sketched on black
  Panel 4 — detailed pencil portrait (upper half) +
            typewriter-style OUTFIT / CHARACTER text annotations
            (lower half)

Usage:
    python3 make_character_sheet.py \\
        --source-url assets/image/hero-photo.jpg \\
        --outfit "Dark gray wool blazer, black crewneck, charcoal trousers, black leather loafers" \\
        --traits "Age ~30, East Asian, calm professional, understated confidence" \\
        --output assets/image/character-sheet-hero.jpg

Flags:
    --source-url  required. Local path or http(s) URL. Local files
                  are inlined as base64 data URI.
    --outfit      optional, comma-separated. If omitted, the model
                  reads the outfit from the source image.
    --traits      optional, comma-separated. If omitted, defaults to
                  the character appearance from the source image.
    --output      required. Workspace-relative path for the sheet.

Environment:
    OPENROUTER_API_KEY     — required; OpenRouter API key
    AUTOVIRAL_PROJECT_DIR  — optional; project root for .env discovery
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import requests

# ── Constants ────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-5.4-image-2"
RESOLUTION_TAG = "1K"     # 1K is the cheapest viable size for the sheet
ASPECT_RATIO = "16:9"

# ── .env loading (lift verbatim from openrouter_generate.py L65-114) ─

def load_env() -> dict[str, str]:
    """[Copy from openrouter_generate.py — same multi-root discovery]."""
    raise NotImplementedError("Copy from openrouter_generate.py")

def get_api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        key = load_env().get("OPENROUTER_API_KEY", "")
    if not key:
        die("[error] OPENROUTER_API_KEY not set (.env or environment)")
    return key

# ── Helpers ──────────────────────────────────────────────────────────

def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)

def csv_to_list(csv: str | None) -> str | None:
    """Normalize a CSV string to "a, b, c". Returns None if csv is None or empty."""
    if not csv:
        return None
    items = [s.strip() for s in csv.split(",") if s.strip()]
    return ", ".join(items) if items else None

MIME_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
}

def resolve_source_url(src: str) -> str:
    """Local path → base64 data URI; http(s) → passthrough."""
    if src.startswith(("http://", "https://")):
        return src
    path = Path(src)
    if not path.exists():
        die(f"[error] source not found: {src}")
    mime = MIME_BY_EXT.get(path.suffix.lower(), "image/jpeg")
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"

# ── Prompt construction ──────────────────────────────────────────────

def build_prompt(*, outfit: str | None, traits: str | None) -> str:
    """4-panel sheet prompt. Each paragraph is editable in isolation.

    Verbatim port of pneuma's make-character-sheet.mjs prompt.
    DO NOT silently rephrase — the wording is part of the contract
    that makes the resulting sheet pass image-side filters.
    """
    outfit_str = outfit or "the outfit visible in the source image"
    traits_str = traits or "the character appearance from the source image"

    paragraphs = [
        "Create a 16:9 character reference design sheet of the character "
        "shown in the source image. Layout: 4 tall vertical panels of "
        "equal width arranged side by side with no gaps, pure black "
        "background throughout.",
        "",
        f"Panel 1 (far left): photographic front view full body of the "
        f"same character, wearing {outfit_str}, neutral standing pose with "
        f"arms at sides and empty hands, soft studio lighting, standing "
        f"on solid black floor. Replace the head (shoulders up) with a "
        f"clean white-line pencil sketch of the frontal head on the black "
        f"background, showing eyes, nose, mouth, hairline.",
        "",
        "Panel 2: photographic left-profile side view full body of the "
        "same character, same outfit, same lighting, facing left. Replace "
        "the head with a clean white-line pencil sketch of a left-profile "
        "head on the black background.",
        "",
        "Panel 3: photographic back view full body of the same character, "
        "same outfit, same lighting. Replace the head with a clean "
        "white-line pencil sketch of the back of the head showing hair "
        "only.",
        "",
        f"Panel 4 (far right): TOP HALF = detailed pencil graphite "
        f"portrait on off-white sketch paper showing the character's face "
        f"in frontal head-and-shoulders framing, preserving the facial "
        f"identity from the source image, fine pencil shading, visible "
        f"pencil strokes and cross-hatching, all features (eyes, nose, "
        f"lips, jaw, hairline) clearly readable — this is a hand-drawn "
        f"portrait study, NOT a photograph. BOTTOM HALF = clean white "
        f"typewriter-style English text on the black background, "
        f"formatted as a character design document. First section header "
        f"'OUTFIT' followed by bullet points listing: {outfit_str}. "
        f"Second section header 'CHARACTER' followed by bullet points "
        f"listing: {traits_str}. Thin horizontal divider lines between "
        f"the sections. Professional game / animation character design "
        f"reference-sheet aesthetic.",
        "",
        "All four panels must show the SAME character. Preserve the "
        "face, hair, skin tone, build, and proportions from the source "
        "image. Do not invent a different character.",
    ]
    return "\n".join(paragraphs)

# ── API call ─────────────────────────────────────────────────────────

def call_openrouter_edit(
    prompt: str, image_url: str, *, api_key: str
) -> bytes:
    """Single OpenRouter call. Returns image bytes. Single error format."""
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }],
        # [verify with team: aspect_ratio / size flags for gpt-5.4-image-2]
    }
    res = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=180,
    )
    if not res.ok:
        die(f"openrouter gpt-5.4-image-2 edit failed ({res.status_code}): {res.text}")
    data = res.json()
    # [extract image bytes — reuse extract_image_data() from openrouter_generate.py]
    images = []  # placeholder
    if not images:
        die(f"openrouter gpt-5.4-image-2 edit returned no image: {data}")
    return images[0][0]

# ── Main ─────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate a photo-body / sketch-head 16:9 character sheet.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--source-url", required=True, help="Local path or http(s) URL of source image")
    p.add_argument("--outfit", default=None, help="Comma-separated outfit items (optional)")
    p.add_argument("--traits", default=None, help="Comma-separated character traits (optional)")
    p.add_argument("--output", required=True, help="Output file path")
    return p.parse_args()

def main() -> None:
    args = parse_args()
    api_key = get_api_key()
    image_url = resolve_source_url(args.source_url)
    prompt = build_prompt(outfit=csv_to_list(args.outfit), traits=csv_to_list(args.traits))
    image_bytes = call_openrouter_edit(prompt, image_url, api_key=api_key)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(image_bytes)
    print(str(out))  # stdout = output path; nothing else

if __name__ == "__main__":
    main()
```

### 7e. Template for `modules/assets/scripts/filter_retry/detect_signature.py` (Phase 2.10)

**Type:** Filter dispatcher — reads JSON envelope from stdin, classifies which filter signature it matches, writes recovery directive to stdout.
**Target length:** ~120-150 lines.
**Mirrors:** No direct pneuma analogue (pneuma's recovery is documented in markdown, not coded). This is an AutoViral innovation — translate the markdown decision tree into a programmatic dispatcher so the agent doesn't have to pattern-match by hand under load.

```python
#!/usr/bin/env python3
"""
Filter-Retry Signature Dispatcher

Reads a JSON envelope from stdin describing a generate-call failure,
classifies it against known content-filter signatures, and writes a
JSON recovery directive to stdout. The agent then carries out the
directive (calling make_character_sheet.py, retrying with --no-audio,
asking the user, etc.).

This script does NOT execute recovery itself — it only classifies.
The classification logic mirrors `capabilities/filter-retries.md`.
When that doc evolves, this script's signature table MUST evolve
in lockstep.

Input envelope (stdin, JSON):
    {
      "provider": "dreamina" | "fal" | "openrouter",
      "operation": "image2video" | "text2video" | "edit_image" | ...,
      "exit_code": <int>,
      "stderr": "<full stderr block from the failed call>",
      "stdout": "<full stdout if any>",
      "args": { "<flag>": "<value>", ... }
    }

Output directive (stdout, JSON):
    {
      "signature": "A" | "B" | "C" | "D" | "E" | "UNKNOWN",
      "action": "make_character_sheet" | "retry_no_audio" |
                "rewrite_prompt" | "fallback_model" |
                "manual_compliance" | "ask_user",
      "params": { ...action-specific... },
      "reason": "<one-line human-readable explanation>",
      "next_command": "<bash recipe to execute, or null>"
    }

Usage:
    cat failure.json | python3 detect_signature.py

Exit code:
    0 — classification produced (even if signature == UNKNOWN)
    1 — input is not parseable JSON or missing required keys
"""

from __future__ import annotations

import json
import sys
from typing import Any

# ── Signature table ──────────────────────────────────────────────────
# Each entry: (signature_id, match_predicate, action_builder)
# match_predicate(envelope) -> bool
# action_builder(envelope) -> dict (the directive payload)

def _match_fal_image_filter(env: dict[str, Any]) -> bool:
    s = env.get("stderr", "")
    return (
        env.get("provider") == "fal"
        and 'loc:["body","image_urls"]' in s
        and "partner_validation_failed" in s
    )

def _action_make_character_sheet(env: dict[str, Any]) -> dict[str, Any]:
    args = env.get("args", {})
    image_url = args.get("--image-url") or args.get("--image")
    return {
        "signature": "A",
        "action": "make_character_sheet",
        "params": {
            "source_url": image_url,
            "outfit": None,
            "traits": None,
            "suggest_no_audio_on_retry": True,
        },
        "reason": "fal image-side rejection — character ref hit photorealistic-face filter",
        "next_command": (
            "python3 skills/autoviral/modules/assets/scripts/make_character_sheet.py "
            f"--source-url {image_url} --output assets/image/character-sheet-<name>.jpg "
            "&& <retry original command with sheet path + --no-audio>"
        ),
    }

# [other signatures: B (no-audio), C (PROHIBITED_CONTENT), D (compliance), E (OpenRouter safety)]

SIGNATURES: list[tuple[str, callable, callable]] = [
    ("A", _match_fal_image_filter, _action_make_character_sheet),
    # ("B", _match_fal_audio_filter, _action_retry_no_audio),
    # ("C", _match_dreamina_prohibited, _action_rewrite_or_fallback),
    # ("D", _match_dreamina_compliance, _action_manual_compliance),
    # ("E", _match_openrouter_safety, _action_rewrite_or_provider_fallback),
]

# ── Main ─────────────────────────────────────────────────────────────

def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)

def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        die("[error] no input on stdin")
    try:
        env = json.loads(raw)
    except json.JSONDecodeError as e:
        die(f"[error] stdin is not valid JSON: {e}")

    for sig_id, predicate, builder in SIGNATURES:
        if predicate(env):
            directive = builder(env)
            print(json.dumps(directive, ensure_ascii=False, indent=2))
            return

    # Fall-through: unknown signature
    print(json.dumps({
        "signature": "UNKNOWN",
        "action": "ask_user",
        "params": {},
        "reason": "no known content-filter signature matched; surface to user",
        "next_command": None,
    }, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```

**Acceptance check for the dispatcher:** the unit test should pass each fixture from `tests/fixtures/filter-rejections/*.json` (the team should produce these from real failures) and assert the produced `signature` matches the fixture's `expected_signature`. Round-trip: every signature documented in `capabilities/filter-retries.md` has at least one fixture; every fixture's `expected_signature` is one of the script's known signatures.

---

## 8. Anti-patterns to avoid

Synthesizing from all three sources plus AutoViral's CLAUDE.md mandates:

### 8.1 Cross-source anti-patterns

| Anti-pattern | Source | Why bad |
|---|---|---|
| **Description summarizes workflow** | obra writing-skills L150-172 | Claude follows the description and skips the body. Concrete regression: code-review skill said "between tasks" → Claude did one review, body said two reviews. |
| **Narrative storytelling in skill body** | obra L562-565 | "In session 2025-10-03 we found…" is too specific. Skills are reference, not memoir. |
| **Multi-language code dilution** | obra L566-569 | Mediocre quality in 5 languages worse than excellent in 1. AutoViral is Python-first; skip Node ports. |
| **Code in flowchart labels** | obra L570-575 | `step1 [label="import fs"]` — can't copy-paste, hard to read. |
| **Generic labels: helper1, step2, pattern3** | obra L580 | Labels should have semantic meaning. |
| **`@filename` cross-references** | obra L286-289 | Force-loads files, burns context. Use plain relative paths. |
| **Skill in narrative form** | obra L23-29 | Skills are reusable techniques, NOT "how I solved this once." |
| **Untested skills in production** | obra L382-393 | RED-GREEN-REFACTOR mandate. AutoViral can't enforce TDD for skill docs across 7 capabilities, but every script must have a sanity-test fixture before merge. |
| **Reference docs containing creative advice** | AutoViral CLAUDE.md mandate | "references/ 只写技术规格，不写创作建议". Mix-up dilutes both. |
| **Module dependencies / forced ordering** | AutoViral CLAUDE.md mandate | "一个 skill, 四个模块——不再有 research → plan → assets → assembly 的强制顺序". Each module SKILL.md must work standalone. |
| **Platform creation tactics in `taste/`** | AutoViral CLAUDE.md mandate | "平台创作建议不进 taste". "Douyin喜欢快剪" goes nowhere — taste is universal craft. Platform technical specs go in `references/<platform>.md`. |
| **Auto-invocation across module boundaries** | AutoViral master plan §2 task 2.6 | Generate scripts must NOT auto-call recovery scripts. The agent decides. (Mirrors pneuma's filter-retry doc explicitly.) |

### 8.2 Specific traps for Phase 2 implementers

**For 2.6 / 2.7 / 2.8 (capability docs):**

- ❌ **Do not** copy pneuma's text verbatim with "AutoViral" find-and-replaced. The Dreamina / OpenRouter API surface differs from fal.ai's. Each call signature must be verified against the actual scripts.
- ❌ **Do not** skip the "Don't use this for…" / "什么时候不用" section. The negative space is half the signal.
- ❌ **Do not** put more than one canonical worked example per usage variant. One excellent example beats five mediocre ones (obra L324-327).
- ❌ **Do not** introduce module dependencies. `assets/capabilities/filter-retries.md` must NOT require the reader to first read anything in `assembly/`. Cross-references between modules go through `references/module-contracts.md` only.
- ❌ **Do not** rephrase the prompt strings used by character-sheet generation. They're a contract — verbatim or it doesn't pass the filter.

**For 2.9 / 2.10 (Python scripts):**

- ❌ **Do not** invent a new `.env` discovery scheme. Reuse `load_env()` from `openrouter_generate.py` — copy the function, don't fork the logic.
- ❌ **Do not** write JSON to stdout when the contract is "stdout = output path". Mixed stdout breaks the agent's `path=$(python3 …)` capture pattern.
- ❌ **Do not** auto-recover. `make_character_sheet.py` does ONE thing (build a sheet); it does NOT also retry the original generate command. That's the agent's job.
- ❌ **Do not** silently fallback to a different model. Every quality-affecting decision is the agent's, not the script's. (Mirrors `fallback-strategy.md` L4: "降级必须透明".)
- ❌ **Do not** swallow stderr from the underlying API call. Re-raise with the canonical `<service> <verb> failed (<status>): <body>` format so signature detection works downstream.
- ❌ **Do not** add CLI flags that aren't documented in the doc-block. `--help` and the doc-block must be the same set.
- ❌ **Do not** skip `output_path.parent.mkdir(parents=True, exist_ok=True)`. Failure here looks like an API error; debugging burns hours.
- ❌ **Do not** hardcode `/tmp` or any absolute path in the script. All paths come from CLI flags.

### 8.3 Anti-patterns at the system level

- ❌ **Do not** make 2.6 / 2.7 / 2.8 / 2.9 / 2.10 sequentially-dependent in the plan. They share a vocabulary but each should compile/lint/test independently.
- ❌ **Do not** add a new top-level module dir under `skills/autoviral/modules/`. Phase 2 adds capabilities and scripts to `assets/`; nothing more.
- ❌ **Do not** modify `taste/`. Phase 2 is operational infrastructure; the prime directive doesn't change.
- ❌ **Do not** modify the umbrella `SKILL.md` as part of 2.6 / 2.7 / 2.8 / 2.9 / 2.10. The optional umbrella additions in §2.5 above are a separate deliverable, not part of these tasks.

---

## 9. Acceptance criteria for Phase 2 skill docs

A code-reviewer reviewing the output of tasks 2.6 / 2.7 / 2.8 / 2.9 / 2.10 should be able to run this checklist top-to-bottom and either approve or request specific changes.

### 9.1 Universal (every Phase 2 deliverable)

- [ ] **Frontmatter** has `name` and `description` fields, no others.
- [ ] **`name`** is `<module>-<topic>` kebab-case (e.g. `assets-filter-retries`).
- [ ] **`description`** opens with "用于…" / "Use when…", lists 3-5 concrete trigger phrases, ends with "不用于…" / "Don't use for…".
- [ ] **`description`** does NOT summarize the workflow (no "covers X then Y then Z").
- [ ] **`description`** is ≤ 500 chars.
- [ ] **File location** matches the structure-guide:
  - Capability docs → `skills/autoviral/modules/assets/capabilities/`
  - Scripts → `skills/autoviral/modules/assets/scripts/`
  - Reference docs (if any new ones) → `skills/autoviral/modules/assets/references/`

### 9.2 Capability docs (2.6 / 2.7 / 2.8)

- [ ] First section is **either** a decision tree (operational) **or** a core principle (discipline) **or** a signature index (failure-mode) — not a wall of prose.
- [ ] At least **one** completely runnable worked example with bash + JSON / Python where applicable.
- [ ] At least **one** "Don't use this for…" / "什么时候不用" callout.
- [ ] **Gotchas** section with 5-10 bullets, one foot-gun per bullet.
- [ ] **See also** section at the bottom with relative paths to sibling capabilities, scripts, and references.
- [ ] **No** auto-loaded `@filename` cross-references.
- [ ] **No** module-dependency on anything outside `modules/assets/`.
- [ ] **No** platform creative advice ("Douyin 喜欢…"). Platform tech specs OK only if in `references/`.
- [ ] **No** copy-pasted prompt fragments without attribution. If a prompt is taken verbatim from pneuma, say so in a comment.
- [ ] **Length** in the recommended band:
  - structured-generation.md: 150-280 lines
  - reference-directives.md: 100-200 lines
  - filter-retries.md: 180-320 lines

### 9.3 Failure-mode docs specifically (2.8 filter-retries)

- [ ] **Signature index** at the top — table mapping observable error tokens → signature ID → recovery section.
- [ ] **Each signature** has: "What you see" (verbatim error block from a fixture), "Key tokens to match", "What it means" (one sentence), "Recovery" (numbered steps), "Do NOT use this workflow for".
- [ ] **At least one signature** has a real fixture from the team — NOT a hypothetical/guessed JSON.
- [ ] **"When neither recovery gets you through"** escape-hatch section exists, names "what to do" and "when to surface to the user".
- [ ] **Cross-reference to `filter_retry/detect_signature.py`** is present so the agent knows the dispatcher exists.

### 9.4 Scripts (2.9 / 2.10)

- [ ] **Module-level docstring** has all 6 sections: Title / What / When agent calls / When agent does NOT call / Usage / Flags / Environment.
- [ ] **`from __future__ import annotations`** present for clean type hints on Python ≥ 3.10.
- [ ] **`die(msg)` helper** is the single chokepoint for stderr + exit non-zero.
- [ ] **`load_env()` and `get_api_key()`** are reused from `openrouter_generate.py` (or copied verbatim, not reinvented).
- [ ] **`argparse`** with `description=__doc__` so `--help` matches the docstring.
- [ ] **All required flags** marked `required=True`.
- [ ] **All optional flags** have documented `default=` values.
- [ ] **Error format** for API failures: `<service> <verb> failed (<status>): <body>` — verbatim shape (consumed by `detect_signature.py`).
- [ ] **stdout** = a single line (output path for generators; JSON directive for dispatchers).
- [ ] **stderr** = everything else (logs, errors, full API responses).
- [ ] **Exit code** = 0 on success, non-zero on failure; nothing in between.
- [ ] **Output dir** is created with `Path(args.output).parent.mkdir(parents=True, exist_ok=True)`.
- [ ] **Prompt strings** that are part of the contract (sheet generation, etc.) are constructed as `"\n".join([para1, "", para2, ...])`, not as one giant f-string.
- [ ] **No** hardcoded absolute paths. Everything comes from CLI flags or env.
- [ ] **No** auto-recovery — the script does its job and exits; the agent decides next steps.
- [ ] **No** silent fallback to alternate models / providers.
- [ ] **Imports** include only the standard library + `requests` + (if needed) the existing AutoViral modules. NO new dependencies without justification.
- [ ] **Line count** in band: 120-250 lines per script.

### 9.5 Cross-cutting (review-time sanity checks)

- [ ] **Round-trip test:** does every "See also" link in the new docs point at a path that exists in the repo (or is being added in the same PR)?
- [ ] **Vocabulary consistency:** "asset / clip / track / scene / provenance" usage matches `references/module-contracts.md` and AutoViral's `types.ts`. No new terms invented.
- [ ] **Voice:** no AI-vocabulary words ("鲁棒"、"全面"、"深入挖掘"、"crucial"、"comprehensive"、"robust"). No em dashes. Direct, builder-to-builder.
- [ ] **Frontmatter consistency:** new docs match the recommended pattern in §1.4 of this brief.
- [ ] **No emojis** in any of the deliverables (per AutoViral house style; emojis only when explicitly requested).
- [ ] **No references to obsolete dirs:** `trend-research/`, `content-planning/`, `asset-generation/`, `content-assembly/`, `content-evaluator/` all merged into `autoviral/modules/`. New docs must not reference the old locations.
- [ ] **Filter-retries.md fixtures:** if real fixtures weren't supplied, the doc explicitly notes "[FIXTURE NEEDED FROM TEAM]" rather than fabricating an error envelope. Reviewer should reject hand-fabricated JSON for production signature matching.

### 9.6 Sign-off statement

The reviewer leaves one of the four statuses (gstack-style, §2.5):

- **DONE** — all checklist items passed, evidence linked.
- **DONE_WITH_CONCERNS** — passed with itemized concerns (each concern names the file + line + why).
- **BLOCKED** — names the blocker (typically "fixtures not yet supplied" for filter-retries).
- **NEEDS_CONTEXT** — names exactly what additional info is needed before review can proceed.

---

## Appendix A — Quote ledger (for fact-checking)

| Claim | Source | Line |
|---|---|---|
| "Description = When to Use, NOT What the Skill Does" | obra writing-skills SKILL.md | L150 |
| "max 1024 characters total" | obra writing-skills SKILL.md | L97 |
| "@ syntax force-loads files immediately" | obra writing-skills SKILL.md | L289 |
| "One excellent example beats many mediocre ones" | obra writing-skills SKILL.md | L326 |
| "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST" | obra TDD SKILL.md | L33-34 |
| "Evidence before claims, always" | obra verification-before-completion SKILL.md | L11 |
| "the source of truth is a structured domain model, not a file" | pneuma clipcraft SKILL.md | L8-10 |
| "Most of the work in ClipCraft is judgment, not mechanics" | pneuma clipcraft SKILL.md | L43-44 |
| "AI generates averages. Art is specific." | pneuma craft.md | L141 |
| "Eighty-five percent of short video is watched muted" | pneuma craft.md | L124 |
| "loc:[body,image_urls] + partner_validation_failed" | pneuma filter-retries.md | L17-28 |
| "Output audio has sensitive content" | pneuma filter-retries.md | L83-90 |
| "16:9 horizontal layout composed of 4 tall vertical panels" | pneuma character-consistency.md | L98 |
| "the `reference` subcommand, not `from-image`" | pneuma character-consistency.md | L156 |
| "stdout is just the output path" | pneuma clipcraft SKILL.md | L73 |
| "Asset / Track / Clip / Scene / Provenance edge / Composition" | pneuma clipcraft SKILL.md | L21-37 |
| "Direct, concrete, builder-to-builder" | gstack SKILL.md | L367-369 |
| "DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT" | gstack SKILL.md | L375-381 |
| "When in doubt, invoke the skill. A false positive is cheaper than a false negative." | gstack SKILL.md | L472-475 |
| "整个创作能力封装成一个 skill" | AutoViral CLAUDE.md | (project root) |
| "taste 是灵魂，modules 是术" | AutoViral docs/skill-structure-guide.md | L11 |
| "references/ 只写技术规格，不写创作建议" | AutoViral docs/skill-structure-guide.md | L78-79 |
| "宁可不交付，不可降质交付" | AutoViral skills/autoviral/SKILL.md | L128 |
| "降级必须透明" | AutoViral skills/autoviral/SKILL.md | L130 |
| "❌ 错误：静默退化到 text2video" | AutoViral assets/capabilities/fallback-strategy.md | L19 |

---

## Appendix B — Implementation sequencing recommendation

The five Phase 2 sub-tasks are *not* sequentially dependent in the strict sense, but there's a high-leverage ordering:

1. **2.8 filter-retries.md** — first, because it forces fixture collection from the team. Once you have real error envelopes, every later task gets sharper.
2. **2.10 detect_signature.py** — second, because it operationalizes 2.8's signature table. Building it surfaces gaps in 2.8 immediately (a missing key, an ambiguous predicate).
3. **2.9 make_character_sheet.py** — third, because it's the recovery action invoked by Signature A in 2.8/2.10. Building it last among the script pair lets you verify the agent's call sequence end-to-end.
4. **2.7 reference-directives.md** — fourth, because it documents the calling convention that triggers Signature A in the first place. Logical reading order for an agent is reference-directives → filter-retries → make_character_sheet.
5. **2.6 structured-generation.md** — fifth, because it ties everything together. The structured-envelope flow is the orchestrator that calls into all four other deliverables.

Reading order for an agent: 2.6 → 2.7 → 2.8 → 2.9 → 2.10. Implementation order: reverse, because building bottom-up surfaces the contracts you need to expose at the top.

---

*End of brief.*
