# Studio Workspace Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Studio from chat-centric to editor-centric workspace with preview, timeline, and asset sidebar — inspired by Pneuma editor layout.

**Architecture:** Decompose monolithic Studio.svelte (2018 lines) into 9 focused components. Layout changes from 3-panel (left pipeline / center chat / right assets) to 4-zone (left assets / center preview+timeline / right chat / bottom pipeline bar). All state management stays in Studio.svelte via Svelte 5 runes, passed as props. Backend/WS protocol unchanged.

**Tech Stack:** Svelte 5 (runes), CSS custom properties (Editorial Noir theme), native DOM drag-and-drop, no new dependencies.

**Branch:** `refactor/studio-workspace`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Rewrite | `web/src/pages/Studio.svelte` | Layout shell, state, WS handler (~400 lines) |
| Create | `web/src/components/StreamBlock.svelte` | Single message block renderer (8 types) |
| Create | `web/src/components/ChatPanel.svelte` | Full chat panel (stream + input + eval) — replaces existing 221-line stub |
| Create | `web/src/components/PipelineBar.svelte` | Horizontal pipeline progress bar |
| Create | `web/src/components/AssetSidebar.svelte` | Left asset panel (type groups + stage tags) |
| Create | `web/src/components/PreviewArea.svelte` | Video player / image viewer, adaptive |
| Create | `web/src/components/Timeline.svelte` | Video timeline (3 tracks) |
| Create | `web/src/components/TrackRow.svelte` | Single timeline track row |
| Create | `web/src/components/ImageLayout.svelte` | Image-text mode: sortable grid + copytext |
| Delete | `web/src/components/CanvasWorkspace.svelte` | Orphaned, unused (1485 lines) |
| Delete | `web/src/components/PipelineSteps.svelte` | Replaced by PipelineBar |
| Delete | `web/src/components/AssetPanel.svelte` | Replaced by AssetSidebar + PreviewArea |

---

## Task 1: Branch Setup + Cleanup Orphaned Components

**Files:**
- Delete: `web/src/components/CanvasWorkspace.svelte`
- Modify: `web/src/pages/Studio.svelte` (verify no imports of deleted files)

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b refactor/studio-workspace
```

- [ ] **Step 2: Delete orphaned CanvasWorkspace**

```bash
rm web/src/components/CanvasWorkspace.svelte
```

- [ ] **Step 3: Verify no imports reference deleted file**

```bash
grep -r "CanvasWorkspace" web/src/
```

Expected: no results (it's already unused).

- [ ] **Step 4: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: delete orphaned CanvasWorkspace.svelte (1485 lines, unused)"
```

---

## Task 2: Extract StreamBlock.svelte

Extract the 8 stream block type renderings from Studio.svelte lines 746-898 into a dedicated component.

**Files:**
- Create: `web/src/components/StreamBlock.svelte`
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Create StreamBlock.svelte**

Create `web/src/components/StreamBlock.svelte` with this content:

```svelte
<script lang="ts">
  import MarkdownBlock from "./MarkdownBlock.svelte";

  interface AskQuestion {
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }

  export interface StreamBlockData {
    type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider" | "ask_question" | "eval_divider";
    text: string;
    toolName?: string;
    collapsed?: boolean;
    questions?: AskQuestion[];
    source?: "creator" | "evaluator";
    evalData?: { type: string; step?: string; attempt?: number; verdict?: string; scores?: Record<string, number>; issues?: any[] };
  }

  let {
    block,
    index,
    streaming = false,
    showFullResult = false,
    onToggle,
    onOptionClick,
    onShowFull,
    onHideFull,
  }: {
    block: StreamBlockData;
    index: number;
    streaming?: boolean;
    showFullResult?: boolean;
    onToggle?: (index: number) => void;
    onOptionClick?: (label: string) => void;
    onShowFull?: (index: number) => void;
    onHideFull?: (index: number) => void;
  } = $props();

  function getToolLabel(name: string): string {
    const map: Record<string, string> = {
      Bash: "终端", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
      Grep: "搜索内容", Glob: "查找文件", WebSearch: "网页搜索", WebFetch: "获取网页",
      Skill: "技能", TodoWrite: "任务", Task: "子任务",
    };
    return map[name] ?? name;
  }

  function getToolAccent(name: string): string {
    const colors: Record<string, string> = {
      Bash: "#d97706", Read: "#2563eb", Write: "#7c3aed", Edit: "#7c3aed",
      Grep: "#059669", Glob: "#059669", WebSearch: "#0891b2", WebFetch: "#0891b2",
      Skill: "#c026d3", TodoWrite: "#ea580c", Task: "#ea580c",
    };
    return colors[name] ?? "#78716c";
  }

  function getToolIcon(name: string): string {
    const icons: Record<string, string> = {
      Bash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
      Read: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      Write: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      Edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
      Grep: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
      Glob: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
      WebSearch: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
      WebFetch: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    };
    return icons[name] ?? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
  }

  function parseToolPreview(toolName: string, text: string): string {
    try {
      const input = JSON.parse(text);
      if (toolName === "Bash" && input.command) return input.command;
      if ((toolName === "Read" || toolName === "Write") && input.file_path) return input.file_path;
      if (toolName === "Edit" && input.file_path) return input.file_path;
      if (toolName === "Grep" && input.pattern) return `/${input.pattern}/` + (input.path ? ` in ${input.path}` : "");
      if (toolName === "Glob" && input.pattern) return input.pattern + (input.path ? ` in ${input.path}` : "");
      if (toolName === "WebSearch" && input.query) return input.query;
      if (toolName === "WebFetch" && input.url) return input.url;
    } catch {}
    return text.slice(0, 80);
  }

  function formatToolExpanded(toolName: string, text: string): { type: string; content: string; oldStr?: string; newStr?: string; filePath?: string } {
    try {
      const input = JSON.parse(text);
      if (toolName === "Bash" && input.command) return { type: "bash", content: input.command };
      if (toolName === "Edit" && input.file_path) return { type: "edit", content: "", filePath: input.file_path, oldStr: input.old_string ?? "", newStr: input.new_string ?? "" };
      if ((toolName === "Read" || toolName === "Write") && input.file_path) return { type: "file", content: input.file_path };
    } catch {}
    return { type: "json", content: text };
  }

  function truncateResult(text: string, lines: number): { truncated: string; total: number; wasTruncated: boolean } {
    const allLines = text.split("\n");
    if (allLines.length <= lines) return { truncated: text, total: allLines.length, wasTruncated: false };
    return { truncated: allLines.slice(-lines).join("\n"), total: allLines.length, wasTruncated: true };
  }
</script>

{#if block.type === "eval_divider"}
  <div class="eval-divider" class:eval-pass={block.evalData?.verdict === "pass"} class:eval-fail={block.evalData?.verdict === "fail"}>
    <span class="eval-divider-line"></span>
    <span class="eval-divider-label">
      {#if block.evalData?.verdict === "pass"}<span class="eval-icon">✓</span>
      {:else if block.evalData?.verdict === "fail"}<span class="eval-icon">✗</span>
      {:else}<span class="eval-icon">◎</span>{/if}
      {block.text}
    </span>
    <span class="eval-divider-line"></span>
  </div>

{:else if block.type === "step_divider"}
  <div class="step-divider">
    <span class="divider-line"></span>
    <span class="divider-label">{block.text}</span>
    <span class="divider-line"></span>
  </div>

{:else if block.type === "user"}
  <div class="stream-block user-block">
    <div class="block-content user-content">{block.text}</div>
  </div>

{:else if block.type === "thinking"}
  <div class="tool-card thinking-card" class:msg-evaluator={block.source === "evaluator"}>
    <button class="tool-card-header" onclick={() => onToggle?.(index)}>
      <span class="tool-card-icon thinking-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
      </span>
      {#if block.source === "evaluator"}<span class="eval-badge">评审</span>{/if}
      <span class="tool-card-label">思考</span>
      <span class="tool-card-meta">{block.text.length} 字</span>
      <span class="tool-card-preview">{block.text.slice(0, 90)}</span>
      <span class="tool-card-chevron">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
    </button>
    {#if !block.collapsed}
      <div class="thinking-card-body"><MarkdownBlock text={block.text} /></div>
    {/if}
  </div>

{:else if block.type === "tool_use"}
  {@const preview = parseToolPreview(block.toolName ?? "", block.text)}
  {@const accent = getToolAccent(block.toolName ?? "")}
  <div class="tool-card" style="--tc-accent: {accent};" class:msg-evaluator={block.source === "evaluator"}>
    <button class="tool-card-header" onclick={() => onToggle?.(index)}>
      <span class="tool-card-icon">{@html getToolIcon(block.toolName ?? "")}</span>
      {#if block.source === "evaluator"}<span class="eval-badge">评审</span>{/if}
      <span class="tool-card-label">{getToolLabel(block.toolName ?? "")}</span>
      <span class="tool-card-preview mono">{preview.slice(0, 80)}</span>
      <span class="tool-card-chevron">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
    </button>
    {#if !block.collapsed}
      {@const fmt = formatToolExpanded(block.toolName ?? "", block.text)}
      <div class="tool-card-body">
        {#if fmt.type === "bash"}
          <pre class="tool-code-block"><code><span class="bash-prompt">$ </span>{fmt.content}</code></pre>
        {:else if fmt.type === "edit"}
          <div class="edit-file-path">{fmt.filePath}</div>
          {#if fmt.oldStr}<pre class="diff-block diff-old">{fmt.oldStr}</pre>{/if}
          {#if fmt.newStr}<pre class="diff-block diff-new">{fmt.newStr}</pre>{/if}
        {:else if fmt.type === "file"}
          <div class="edit-file-path">{fmt.content}</div>
        {:else}
          <pre class="tool-code-block"><code>{fmt.content}</code></pre>
        {/if}
      </div>
    {/if}
  </div>

{:else if block.type === "tool_result"}
  {@const hasError = /[Ee]rror/.test(block.text.slice(0, 500))}
  {@const resultData = showFullResult ? { truncated: block.text, total: block.text.split("\n").length, wasTruncated: false } : truncateResult(block.text, 15)}
  <div class="tool-card result-card" class:result-error={hasError}>
    <button class="tool-card-header result-header" onclick={() => onToggle?.(index)}>
      <span class="tool-card-icon result-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      </span>
      <span class="tool-card-label result-label-text">{hasError ? "错误输出" : "执行结果"}</span>
      <span class="tool-card-meta">{block.text.split("\n").length} 行</span>
      <span class="tool-card-chevron">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
    </button>
    {#if !block.collapsed}
      <div class="result-card-body">
        <pre class="result-pre">{resultData.truncated}</pre>
        {#if resultData.wasTruncated}
          <button class="show-all-btn" onclick={() => onShowFull?.(index)}>显示全部 ({resultData.total} 行)</button>
        {/if}
        {#if showFullResult && block.text.split("\n").length > 15}
          <button class="show-all-btn" onclick={() => onHideFull?.(index)}>收起</button>
        {/if}
      </div>
    {/if}
  </div>

{:else if block.type === "ask_question" && block.questions}
  <div class="stream-block ask-block">
    {#each block.questions as q}
      <div class="ask-question">
        <div class="ask-header">{q.question}</div>
        <div class="ask-options">
          {#each q.options as opt}
            <button class="ask-option" onclick={() => onOptionClick?.(opt.label)} disabled={streaming}>
              <span class="opt-label">{opt.label}</span>
              {#if opt.description}<span class="opt-desc">{opt.description}</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

{:else}
  <div class="stream-block text-block fade-in" class:msg-evaluator={block.source === "evaluator"}>
    {#if block.source === "evaluator"}
      <div class="block-label text-label"><span class="eval-badge">评审</span></div>
    {/if}
    <div class="block-content text-content"><MarkdownBlock text={block.text} /></div>
  </div>
{/if}

<style>
  /* All stream block styles — extracted from Studio.svelte */
  .stream-block { max-width: 100%; }
  .block-label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.15rem; }
  .block-content { color: var(--text); }

  .step-divider { display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0 1rem; }
  .divider-line { flex: 1; height: 2px; background: linear-gradient(90deg, var(--spark-red, #FE2C55), transparent); opacity: 0.35; }
  .divider-label { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-size: 0.82rem; font-weight: 700; color: var(--spark-red, #FE2C55); letter-spacing: 0.08em; white-space: nowrap; padding: 0.3rem 1rem; border: 2px solid var(--spark-red, #FE2C55); border-radius: 6px; background: rgba(254, 44, 85, 0.06); }

  .user-block { align-self: flex-end; max-width: 70%; }
  .user-content { background: var(--bg-surface, #edeae5); color: var(--text); padding: 0.65rem 1rem; border-radius: 18px 18px 4px 18px; font-size: 0.85rem; line-height: 1.65; font-weight: 450; border: 1px solid var(--border); }

  .tool-card { --tc-accent: #78716c; border-radius: 20px; margin: 2px 0; border: none; background: transparent; }
  .tool-card.thinking-card { --tc-accent: #e47a9f; }
  .tool-card.result-card { --tc-accent: #a1a1aa; }
  .tool-card.result-error { --tc-accent: #ef4444; }

  .text-block { margin: 0.6rem 0 0.15rem; padding: 0.2rem 0; }

  .tool-card-header { display: inline-flex; align-items: center; gap: 0.45rem; background: var(--bg-surface, #edeae5); border: 1px solid var(--border); border-radius: 20px; color: var(--text-secondary, #57534e); cursor: pointer; font-family: inherit; font-size: 0.74rem; padding: 0.35rem 0.75rem 0.35rem 0.5rem; text-align: left; transition: all 0.15s ease; min-height: 30px; width: auto; }
  .tool-card-header:hover { background: var(--bg-hover, #dfdbd5); border-color: var(--text-dim); }

  .tool-card-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: var(--tc-accent); color: white; padding: 4px; }
  .tool-card-label { font-weight: 550; font-size: 0.74rem; color: var(--text-secondary, #57534e); flex-shrink: 0; }
  .result-label-text { color: var(--text-muted); }
  .tool-card-meta { font-size: 0.64rem; color: var(--text-dim); flex-shrink: 0; }
  .tool-card-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); font-size: 0.68rem; max-width: 300px; }
  .tool-card-preview.mono { font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace; font-size: 0.66rem; }
  .tool-card-chevron { font-size: 0.6rem; color: var(--text-dim); flex-shrink: 0; width: 0.8rem; text-align: center; opacity: 0.5; }

  .thinking-card-body { padding: 0.65rem 0.85rem; font-size: 0.78rem; color: var(--text-secondary, var(--text-muted)); max-height: 240px; overflow-y: auto; margin: 0.25rem 0 0.5rem; background: var(--bg-surface, #edeae5); border: 1px solid var(--border); border-radius: 10px; }
  .tool-card-body { padding: 0.5rem 0.65rem; margin: 0.25rem 0 0.5rem; background: var(--bg-surface, #edeae5); border: 1px solid var(--border); border-radius: 10px; max-height: 220px; overflow-y: auto; }

  .tool-code-block { font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace; font-size: 0.72rem; color: var(--text); white-space: pre-wrap; word-break: break-word; margin: 0; padding: 0.4rem 0.6rem; background: var(--bg-inset, rgba(0,0,0,0.05)); border-radius: 8px; line-height: 1.55; }
  .bash-prompt { color: var(--tc-accent, #d97706); user-select: none; font-weight: 700; }
  .edit-file-path { font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace; font-size: 0.68rem; color: var(--text-muted); padding: 0.2rem 0; margin-bottom: 0.25rem; font-weight: 500; opacity: 0.8; }
  .diff-block { font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace; font-size: 0.7rem; white-space: pre-wrap; word-break: break-word; margin: 0.2rem 0; padding: 0.4rem 0.6rem; border-radius: 6px; line-height: 1.5; max-height: 160px; overflow-y: auto; }
  .diff-old { background: rgba(239,68,68,0.08); border-left: 3px solid #ef4444; }
  .diff-new { background: rgba(34,197,94,0.08); border-left: 3px solid #22c55e; }

  .result-card-body { padding: 0.4rem 0.5rem; margin: 0.25rem 0 0.5rem; background: var(--bg-surface, #edeae5); border: 1px solid var(--border); border-radius: 10px; }
  .result-error .result-card-body { border-color: rgba(239,68,68,0.2); }
  .result-pre { font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace; font-size: 0.69rem; color: var(--text-secondary, var(--text)); white-space: pre-wrap; word-break: break-word; margin: 0; max-height: 200px; overflow-y: auto; line-height: 1.45; }
  .show-all-btn { display: inline-block; background: none; border: none; color: var(--spark-red, #FE2C55); font-size: 0.68rem; font-weight: 700; cursor: pointer; padding: 0.3rem 0; font-family: inherit; }
  .show-all-btn:hover { text-decoration: underline; }

  .text-label { color: var(--spark-red, #FE2C55); font-size: 0.62rem; }
  .text-content { padding: 0; font-size: 0.88rem; line-height: 1.8; color: var(--text); }
  .fade-in { animation: fadeSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .ask-block { max-width: 90%; }
  .ask-question { display: flex; flex-direction: column; gap: 0.5rem; }
  .ask-header { font-size: 0.84rem; font-weight: 600; color: var(--text); line-height: 1.5; }
  .ask-options { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .ask-option { display: flex; flex-direction: column; gap: 0.1rem; background: var(--bg-surface); border: 1.5px solid var(--border); border-radius: 10px; padding: 0.5rem 0.85rem; cursor: pointer; font-family: inherit; text-align: left; transition: all 0.15s ease; }
  .ask-option:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
  .ask-option:disabled { opacity: 0.5; cursor: not-allowed; }
  .opt-label { font-size: 0.82rem; font-weight: 650; color: var(--text); }
  .opt-desc { font-size: 0.7rem; color: var(--text-dim); line-height: 1.35; }

  .msg-evaluator { border-left: 3px solid var(--amber, #f59e0b); background: color-mix(in srgb, var(--amber, #f59e0b) 5%, transparent); border-radius: 8px; margin: 4px 0; padding-left: 12px; }
  .eval-badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--amber, #f59e0b) 15%, transparent); color: var(--amber, #f59e0b); letter-spacing: 0.5px; }
  .eval-divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; padding: 0 8px; }
  .eval-divider-line { flex: 1; height: 1px; background: color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent); }
  .eval-divider-label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--amber, #f59e0b); white-space: nowrap; }
  .eval-divider.eval-pass .eval-divider-line { background: color-mix(in srgb, #22c55e 30%, transparent); }
  .eval-divider.eval-pass .eval-divider-label { color: #22c55e; }
  .eval-divider.eval-fail .eval-divider-line { background: color-mix(in srgb, #ef4444 30%, transparent); }
  .eval-divider.eval-fail .eval-divider-label { color: #ef4444; }
  .eval-icon { font-size: 14px; font-weight: 700; }
</style>
```

- [ ] **Step 2: Update Studio.svelte to use StreamBlock**

In Studio.svelte, add the import at the top of the `<script>`:

```typescript
import StreamBlock from "../components/StreamBlock.svelte";
```

Replace the `{#each streamBlocks as block, i}` block (lines 745-885) with:

```svelte
{#each streamBlocks as block, i}
  <StreamBlock
    {block}
    index={i}
    {streaming}
    showFullResult={!!showFullResult[i]}
    onToggle={(idx) => { streamBlocks[idx].collapsed = !streamBlocks[idx].collapsed; streamBlocks = [...streamBlocks]; }}
    onOptionClick={handleOptionClick}
    onShowFull={(idx) => { showFullResult[idx] = true; showFullResult = { ...showFullResult }; }}
    onHideFull={(idx) => { showFullResult[idx] = false; showFullResult = { ...showFullResult }; }}
  />
{/each}
```

Remove from Studio.svelte script section: `getToolLabel`, `getToolAccent`, `getToolIcon`, `parseToolPreview`, `formatToolExpanded`, `truncateResult`, `getThinkingGroup`, `toggleBlock` functions (lines 318-450).

Remove from Studio.svelte `<style>`: all stream block styles (`.stream-block` through `.eval-icon`, roughly lines 1252-1870). Keep layout styles (`.studio-layout`, `.studio-body`, `.panel-*`, `.input-*`, etc).

- [ ] **Step 3: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract StreamBlock.svelte from Studio (8 message types)"
```

---

## Task 3: Extract ChatPanel.svelte

Extract the chat stream area, input area, eval-blocked panel, and attachment system from Studio.svelte into ChatPanel.svelte.

**Files:**
- Rewrite: `web/src/components/ChatPanel.svelte` (replace existing 221-line stub)
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Rewrite ChatPanel.svelte**

Replace `web/src/components/ChatPanel.svelte` with a complete implementation that includes:

**Script section:**
- Props: `streamBlocks`, `streaming`, `activeToolName`, `evalBlocked`, `sessionReady`, `workId`, `assets` (string array for picker)
- Events: `on:send({ text, attachments })`, `on:abort()`, `on:evalForcePass()`, `on:evalRetry(guidance)`
- Local state: `inputText`, `inputEl`, `scrollEl`, `attachments`, `showAssetPicker`, `pickerAssets`, `pickerCategory`, `showFullResult`, `guidanceText`
- Import `StreamBlock` component
- Include all attachment logic (`addAttachment`, `removeAttachment`, `formatAttachments`, `openPicker`, `handleLocalUpload`)
- Include `handleSend`, `handleKeydown`, `autoResizeInput`, `scrollToBottom`
- `$effect` to auto-scroll when `streamBlocks` changes

**Template section:**
- `.chat-panel` wrapper (flex column, full height)
- `.stream-area` with `{#each streamBlocks}` using `<StreamBlock>` 
- Streaming indicator (tool-active / thinking-active)
- Eval-blocked panel (conditional)
- `.input-area` with attachment bar, asset picker popover, textarea + buttons

**Style section:**
- All chat-specific styles from Studio.svelte: `.stream-area`, `.streaming-indicator`, `.pulse-dot`, `.input-bar`, `.input-wrapper`, `.msg-input`, `.send-btn`, `.attachment-*`, `.asset-picker-*`, `.eval-blocked-*`

- [ ] **Step 2: Update Studio.svelte**

Replace the import:
```typescript
// Remove: import AssetPanel from "../components/AssetPanel.svelte";
import ChatPanel from "../components/ChatPanel.svelte";
```

Replace the entire `.panel-main` div (lines 743-997) with:
```svelte
<div class="panel-main">
  <ChatPanel
    {streamBlocks}
    {streaming}
    {activeToolName}
    {evalBlocked}
    {sessionReady}
    {workId}
    assets={[]}
    onSend={({ text, attachments }) => {
      const fullText = text + (attachments.length ? "\n\n" + attachments.map(a => `[附件: ${a.url}]`).join("\n") : "");
      streamBlocks = [...streamBlocks, { type: "user", text: fullText }];
      streaming = true;
      showNextStep = false;
      wsConn?.send(fullText);
    }}
    onAbort={handleAbort}
    onEvalForcePass={handleForcePass}
    onEvalRetry={(guidance) => {
      guidanceText = guidance;
      handleRetryWithGuidance();
    }}
    onOptionClick={handleOptionClick}
  />
</div>
```

Remove from Studio.svelte script: `inputText`, `inputEl`, `scrollEl`, `attachments`, `showAssetPicker`, `pickerAssets`, `pickerCategory`, `showFullResult`, `addAttachment`, `removeAttachment`, `formatAttachments`, `openPicker`, `handleLocalUpload`, `handleKeydown`, `autoResizeInput`, `scrollToBottom`, `handleSend`, CATS constant.

Remove from Studio.svelte style: all input-area and attachment styles.

- [ ] **Step 3: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract ChatPanel.svelte with full chat, input, and eval UI"
```

---

## Task 4: Create PipelineBar.svelte (Horizontal)

Replace vertical PipelineSteps with horizontal progress bar.

**Files:**
- Create: `web/src/components/PipelineBar.svelte`
- Modify: `web/src/pages/Studio.svelte`
- Delete: `web/src/components/PipelineSteps.svelte` (after replacement)

- [ ] **Step 1: Create PipelineBar.svelte**

Create `web/src/components/PipelineBar.svelte`:

```svelte
<script lang="ts">
  import type { PipelineStep } from "../lib/api";

  let {
    pipeline = {},
    currentStep = "",
    streaming = false,
    canAdvance = false,
    onSelectStep,
  }: {
    pipeline: Record<string, PipelineStep>;
    currentStep: string;
    streaming?: boolean;
    canAdvance?: boolean;
    onSelectStep?: (stepKey: string) => void;
  } = $props();

  const stepIcons: Record<string, string> = {
    done: "✓",
    active: "●",
    evaluating: "◎",
    eval_blocked: "⚠",
    skipped: "—",
    pending: "○",
  };

  function isClickable(step: PipelineStep, key: string): boolean {
    if (streaming) return false;
    if (step.status === "done" || step.status === "skipped") return true;
    if (step.status === "pending" && canAdvance) return true;
    return false;
  }
</script>

<div class="pipeline-bar">
  {#each Object.entries(pipeline) as [key, step], i}
    {@const status = step.status}
    {@const isActive = key === currentStep && (status === "active" || status === "evaluating")}
    <button
      class="pipeline-step"
      class:done={status === "done"}
      class:active={isActive}
      class:evaluating={status === "evaluating"}
      class:eval-blocked={status === "eval_blocked"}
      class:pending={status === "pending"}
      class:clickable={isClickable(step, key)}
      disabled={!isClickable(step, key)}
      onclick={() => onSelectStep?.(key)}
    >
      <span class="step-icon" class:pulse={isActive}>{stepIcons[status] ?? "○"}</span>
      <span class="step-name">{step.name}</span>
    </button>
    {#if i < Object.entries(pipeline).length - 1}
      <span class="step-connector" class:done={status === "done"}></span>
    {/if}
  {/each}
</div>

<style>
  .pipeline-bar {
    display: flex;
    align-items: center;
    gap: 0;
    height: 48px;
    padding: 0 1.5rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated, var(--bg));
    flex-shrink: 0;
  }

  .pipeline-step {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    border: none;
    background: none;
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    cursor: default;
    transition: all 0.15s;
    white-space: nowrap;
    border-radius: 6px;
  }

  .pipeline-step.clickable { cursor: pointer; }
  .pipeline-step.clickable:hover { background: rgba(255,255,255,0.04); color: var(--text); }

  .pipeline-step.done { color: var(--state-done, #22c55e); }
  .pipeline-step.active { color: var(--spark-red, #FE2C55); }
  .pipeline-step.evaluating { color: var(--amber, #f59e0b); }
  .pipeline-step.eval-blocked { color: #ef4444; }
  .pipeline-step.pending { color: var(--text-dim); opacity: 0.5; }

  .step-icon { font-size: 0.9rem; flex-shrink: 0; }
  .step-icon.pulse { animation: pulseGlow 1.5s ease-in-out infinite; }

  .step-connector {
    flex: 0 0 24px;
    height: 2px;
    background: var(--border);
    margin: 0 0.15rem;
    transition: background 0.2s;
  }
  .step-connector.done { background: var(--state-done, #22c55e); opacity: 0.4; }

  .step-name { letter-spacing: -0.01em; }

  @keyframes pulseGlow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
```

- [ ] **Step 2: Update Studio.svelte layout**

Replace PipelineSteps import with PipelineBar:
```typescript
// Remove: import PipelineSteps from "../components/PipelineSteps.svelte";
import PipelineBar from "../components/PipelineBar.svelte";
```

Remove the `.panel-left` div entirely (lines 728-740). Add PipelineBar after `.studio-body`:

```svelte
<PipelineBar
  pipeline={work?.pipeline ?? {}}
  {currentStep}
  {streaming}
  canAdvance={showNextStep && !streaming}
  onSelectStep={(key) => { if (!streaming) triggerStep(key); }}
/>
```

- [ ] **Step 3: Delete old PipelineSteps**

```bash
rm web/src/components/PipelineSteps.svelte
```

- [ ] **Step 4: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: replace vertical PipelineSteps with horizontal PipelineBar"
```

---

## Task 5: Create AssetSidebar.svelte

Left panel with type-grouped assets and stage tags.

**Files:**
- Create: `web/src/components/AssetSidebar.svelte`
- Modify: `web/src/pages/Studio.svelte`
- Delete: `web/src/components/AssetPanel.svelte` (after replacement)

- [ ] **Step 1: Create AssetSidebar.svelte**

Create `web/src/components/AssetSidebar.svelte` with:

**Props:** `workId`, `assets` (string[]), `selectedAsset`, `onSelect`

**Logic:**
- Classify assets into groups: IMAGES (png/jpg/webp/gif), CLIPS (mp4/mov/webm), AUDIO (mp3/wav/aac, not bgm), BGM (contains 'bgm' in name/path), REFERENCE (others)
- Stage tag inference: path contains `research/` or `trends/` → "调研", `output/` → "成品", `bgm/` → "配乐", else → "AI生成"
- Each group is collapsible with count badge
- Images/clips show thumbnail grid; audio/reference show list items
- Click fires `onSelect(assetPath)`
- 5-second polling via `setInterval` to fetch `/api/works/:id/assets`

**Template:**
- Scrollable sidebar with sections per group
- Each item: thumbnail or icon + filename + stage pill

**Style:**
- 200px wide, dark background, compact thumbnails (48x48 grid)

- [ ] **Step 2: Update Studio.svelte**

Add import and state:
```typescript
import AssetSidebar from "../components/AssetSidebar.svelte";
let assetFiles: string[] = $state([]);
let selectedAsset: string | null = $state(null);
```

Add a 5-second poller in `onMount` (or keep existing refresh logic) that fetches asset list.

Add AssetSidebar to the layout as the left panel:
```svelte
<div class="panel-left">
  <AssetSidebar {workId} assets={assetFiles} {selectedAsset} onSelect={(path) => selectedAsset = path} />
</div>
```

Remove the old `.panel-right` div with `<AssetPanel>`.

- [ ] **Step 3: Delete old AssetPanel**

```bash
rm web/src/components/AssetPanel.svelte
```

- [ ] **Step 4: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: replace AssetPanel with AssetSidebar (type groups + stage tags)"
```

---

## Task 6: Create PreviewArea.svelte

Center preview panel: video player for short-video, image viewer for image-text.

**Files:**
- Create: `web/src/components/PreviewArea.svelte`
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Create PreviewArea.svelte**

Create `web/src/components/PreviewArea.svelte` with:

**Props:** `contentType`, `workId`, `assets` (string[]), `selectedAsset`
**Events:** `on:select(path)`, `on:timeUpdate(seconds)`

**Short-video mode:**
- `<video>` element with custom controls (play/pause, progress bar, time display)
- Displays selected clip, or final video if available, or placeholder
- Fires `timeUpdate` on `ontimeupdate`

**Image-text mode:**
- Large image display with left/right navigation arrows
- Bottom thumbnail strip for quick navigation
- Zoom on click (optional, can be simple)

**Common:**
- Centered content with dark background
- Placeholder state: "暂无素材" with icon

- [ ] **Step 2: Add to Studio layout**

```svelte
<div class="panel-center">
  <div class="preview-wrapper">
    <PreviewArea
      contentType={work?.type ?? "short-video"}
      {workId}
      assets={assetFiles}
      {selectedAsset}
      onSelect={(path) => selectedAsset = path}
      onTimeUpdate={(t) => currentTime = t}
    />
  </div>
  <!-- Timeline/ImageLayout will go here in next tasks -->
</div>
```

- [ ] **Step 3: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add PreviewArea with video player and image viewer"
```

---

## Task 7: Create TrackRow.svelte + Timeline.svelte

Timeline for short-video mode with 3 tracks: video, audio, subtitle.

**Files:**
- Create: `web/src/components/TrackRow.svelte`
- Create: `web/src/components/Timeline.svelte`
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Create TrackRow.svelte**

A single timeline track row. Props: `label`, `items` (array of `{ id, start, duration, label, thumbnail? }`), `totalDuration`, `currentTime`, `draggable`.

Each item is rendered as a proportionally-sized block within the track. Supports:
- Drag to reorder (if `draggable`)
- Click to select
- Right-click context menu placeholder (fires event)

Renders a playhead indicator at `currentTime` position.

- [ ] **Step 2: Create Timeline.svelte**

Container for 3 TrackRow instances. Props: `clips`, `audio`, `subtitles`, `currentTime`, `workId`.
Events: `on:reorder(newOrder)`, `on:action({ type, target, payload })`, `on:seek(seconds)`.

Computes `totalDuration` from clips. Passes appropriate items to each TrackRow:
- Video track: clips with thumbnails
- Audio track: single BGM item spanning full duration
- Subtitle track: subtitle entries with text labels

Clicking on the timeline ruler fires `seek` event.

- [ ] **Step 3: Add Timeline to Studio layout**

Below PreviewArea in `.panel-center`:
```svelte
{#if work?.type === "short-video"}
  <Timeline
    clips={videoClips}
    audio={audioInfo}
    subtitles={subtitleEntries}
    {currentTime}
    {workId}
    onReorder={(order) => handleTimelineAction("reorder", order)}
    onAction={(action) => handleTimelineAction(action.type, action)}
    onSeek={(t) => currentTime = t}
  />
{/if}
```

Add `handleTimelineAction` function that converts timeline operations to chat messages (per spec's action→instruction mapping table).

- [ ] **Step 4: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Timeline with 3-track layout (video/audio/subtitle)"
```

---

## Task 8: Create ImageLayout.svelte

Image-text mode: sortable image grid + copytext preview.

**Files:**
- Create: `web/src/components/ImageLayout.svelte`
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Create ImageLayout.svelte**

Props: `images` (array of `{ path, thumbnail, order }`), `copytext` ({ title, body, tags, topics } | null), `workId`.
Events: `on:reorder(newOrder)`, `on:select(path)`, `on:action({ type, target })`.

**Template:**
- Top section: horizontal scrollable image grid with drag-to-reorder
- Each image: thumbnail + order number badge + right-click menu (replace/delete)
- Bottom section: copytext display (title, body, tags) — read-only, styled
- "Add" button at end of image grid (fires action)

**Style:**
- Images: 80x80 thumbnails in a row, border on selected, drag handle
- Copytext: clean typography, tags as pills

- [ ] **Step 2: Add to Studio layout**

Below PreviewArea, conditional on content type:
```svelte
{#if work?.type === "image-text"}
  <ImageLayout
    images={imageFiles}
    copytext={parsedCopytext}
    {workId}
    onReorder={(order) => handleImageAction("reorder", order)}
    onSelect={(path) => selectedAsset = path}
    onAction={(action) => handleImageAction(action.type, action)}
  />
{/if}
```

Add `handleImageAction` that converts to chat messages.

- [ ] **Step 3: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add ImageLayout with sortable grid and copytext preview"
```

---

## Task 9: Rewrite Studio.svelte Layout Shell

Final assembly: rewrite Studio layout to the 4-zone structure.

**Files:**
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Rewrite Studio template**

Replace the entire template section with the new 4-zone layout:

```svelte
<svelte:window on:pointerdown={() => { showTypeDropdown = false; showCategoryDropdown = false; }} />
<div class="studio-layout">
  <!-- Header (unchanged) -->
  <div class="studio-header">
    <!-- ... keep existing header content ... -->
  </div>

  <!-- Main body: 3-column layout -->
  <div class="studio-body">
    <!-- Left: Asset Sidebar (200px) -->
    <div class="panel-left">
      <AssetSidebar {workId} assets={assetFiles} {selectedAsset} onSelect={(path) => selectedAsset = path} />
    </div>

    <!-- Center: Preview + Timeline/ImageLayout -->
    <div class="panel-center">
      <div class="preview-wrapper">
        <PreviewArea
          contentType={work?.type ?? "short-video"}
          {workId}
          assets={assetFiles}
          {selectedAsset}
          onSelect={(path) => selectedAsset = path}
          onTimeUpdate={(t) => currentTime = t}
        />
      </div>
      <!-- Horizontal resize handle for timeline height -->
      <div class="timeline-resize-handle" onpointerdown={handleTimelineResize}></div>
      <div class="timeline-wrapper" style="height: {timelineHeight}px;">
        {#if work?.type === "short-video"}
          <Timeline clips={videoClips} audio={audioInfo} subtitles={subtitleEntries} {currentTime} {workId}
            onReorder={(order) => handleTimelineAction("reorder", order)}
            onAction={(action) => handleTimelineAction(action.type, action)}
            onSeek={(t) => currentTime = t}
          />
        {:else}
          <ImageLayout images={imageFiles} copytext={parsedCopytext} {workId}
            onReorder={(order) => handleImageAction("reorder", order)}
            onSelect={(path) => selectedAsset = path}
            onAction={(action) => handleImageAction(action.type, action)}
          />
        {/if}
      </div>
    </div>

    <!-- Vertical resize handle -->
    <div class="panel-resize-handle" onpointerdown={handleChatResize}></div>

    <!-- Right: Chat Panel (380px, resizable) -->
    <div class="panel-right" style="width: {chatPanelWidth}px;">
      <ChatPanel
        {streamBlocks} {streaming} {activeToolName} {evalBlocked} {sessionReady} {workId}
        onSend={handleChatSend}
        onAbort={handleAbort}
        onEvalForcePass={handleForcePass}
        onEvalRetry={handleRetryWithGuidance}
        onOptionClick={handleOptionClick}
      />
    </div>
  </div>

  <!-- Bottom: Pipeline Bar -->
  <PipelineBar
    pipeline={work?.pipeline ?? {}}
    {currentStep}
    {streaming}
    canAdvance={showNextStep && !streaming}
    onSelectStep={(key) => { if (!streaming) triggerStep(key); }}
  />
</div>
```

- [ ] **Step 2: Update Studio styles**

Replace layout styles for the new 4-zone structure:

```css
.studio-layout {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 52px);
  min-height: 0;
  overflow: hidden;
}

.studio-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-left {
  width: 200px;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

.panel-center {
  flex: 1;
  min-width: 400px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-wrapper {
  flex: 1;
  min-height: 200px;
  overflow: hidden;
}

.timeline-wrapper {
  flex-shrink: 0;
  overflow: hidden;
  border-top: 1px solid var(--border);
}

.timeline-resize-handle {
  height: 5px;
  cursor: row-resize;
  background: transparent;
  transition: background 0.15s;
}
.timeline-resize-handle:hover,
.timeline-resize-handle:active {
  background: var(--spark-red, #FE2C55);
  opacity: 0.3;
}

.panel-right {
  flex-shrink: 0;
  overflow: hidden;
  border-left: 1px solid var(--border);
}

.panel-resize-handle {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}
.panel-resize-handle:hover,
.panel-resize-handle:active {
  background: var(--spark-red, #FE2C55);
  opacity: 0.3;
}

@media (max-width: 1024px) {
  .panel-left { display: none; }
}
@media (max-width: 768px) {
  .panel-right { display: none; }
}
```

- [ ] **Step 3: Add new state variables and handlers**

```typescript
let chatPanelWidth = $state(380);
let timelineHeight = $state(220);
let currentTime = $state(0);
let assetFiles: string[] = $state([]);
let selectedAsset: string | null = $state(null);

// Derived data for Timeline
let videoClips = $derived(/* filter clips from assetFiles */);
let audioInfo = $derived(/* find BGM from assetFiles */);
let subtitleEntries = $derived(/* parse subtitles if available */);
let imageFiles = $derived(/* filter images for image-text mode */);
let parsedCopytext = $derived(/* parse copytext.md from output */);

function handleTimelineAction(type: string, payload: any) {
  // Convert to natural language and send to chat
  const messages: Record<string, string> = {
    reorder: `请把视频片段重新排列为: ${payload.join(", ")}`,
    delete: `请删除视频片段 ${payload.target}`,
    replace: `请重新生成第${payload.index}个视频片段`,
    replaceBgm: `请更换背景音乐`,
    editSubtitle: `请把字幕从"${payload.old}"改为"${payload.new}"`,
  };
  const text = messages[type] ?? `请调整: ${type}`;
  handleChatSend({ text, attachments: [] });
}

function handleImageAction(type: string, payload: any) {
  const messages: Record<string, string> = {
    reorder: `请把图片重新排列为: ${payload.join(", ")}`,
    delete: `请删除图片 ${payload.target}`,
    replace: `请重新生成图片 ${payload.target}`,
  };
  const text = messages[type] ?? `请调整图片: ${type}`;
  handleChatSend({ text, attachments: [] });
}

function handleChatSend({ text, attachments }: { text: string; attachments: any[] }) {
  const fullText = text + (attachments.length ? "\n\n" + attachments.map((a: any) => `[附件: ${a.url}]`).join("\n") : "");
  streamBlocks = [...streamBlocks, { type: "user", text: fullText }];
  streaming = true;
  showNextStep = false;
  wsConn?.send(fullText);
}

function handleChatResize(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = chatPanelWidth;
  const onMove = (ev: PointerEvent) => { chatPanelWidth = Math.max(280, Math.min(600, startW + (startX - ev.clientX))); };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function handleTimelineResize(e: PointerEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startH = timelineHeight;
  const onMove = (ev: PointerEvent) => { timelineHeight = Math.max(150, Math.min(400, startH + (ev.clientY - startY))); };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
```

- [ ] **Step 4: Clean up Studio.svelte**

Remove all code that was extracted to child components. The final Studio.svelte should be ~400 lines containing only:
- Imports for all child components
- State management (work, streamBlocks, streaming, pipeline, assets, etc.)
- WebSocket handler
- Step trigger logic
- Type/category switching
- Layout template + layout-only styles

- [ ] **Step 5: Build check**

```bash
cd web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: rewrite Studio layout to 4-zone editor-centric workspace"
```

---

## Task 10: Visual Polish + Responsive

Final pass: visual refinement, responsive breakpoints, and dark theme verification.

**Files:**
- Modify: multiple component styles

- [ ] **Step 1: Verify dark theme**

Start the dev server and check all components render correctly with the dark theme. Fix any hardcoded colors that don't use CSS custom properties.

```bash
cd web && npx vite dev &
```

- [ ] **Step 2: Test responsive breakpoints**

Verify:
- `< 1024px`: Asset sidebar hides
- `< 768px`: Chat panel hides, center takes full width
- All panels handle minimum widths gracefully

- [ ] **Step 3: Fix any visual issues**

Address spacing, alignment, overflow, and scroll behavior across all new components.

- [ ] **Step 4: Final build**

```bash
cd web && npx vite build 2>&1 | tail -5
```

Expected: clean build, no warnings.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "style: polish dark theme, responsive breakpoints, and visual alignment"
```

---

## Summary

| Task | Component | Action |
|------|-----------|--------|
| 1 | Cleanup | Delete CanvasWorkspace |
| 2 | StreamBlock | Extract 8 message types |
| 3 | ChatPanel | Extract full chat + input + eval |
| 4 | PipelineBar | Horizontal pipeline progress |
| 5 | AssetSidebar | Type-grouped asset panel |
| 6 | PreviewArea | Video player + image viewer |
| 7 | Timeline + TrackRow | 3-track video timeline |
| 8 | ImageLayout | Sortable image grid + copytext |
| 9 | Studio layout | 4-zone assembly |
| 10 | Polish | Dark theme + responsive |

Each task produces a working, buildable state. Tasks 2-5 are extraction/replacement tasks that maintain existing functionality. Tasks 6-8 add new visual components. Task 9 assembles the final layout. Task 10 polishes.
