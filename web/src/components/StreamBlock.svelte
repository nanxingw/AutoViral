<script lang="ts">
  import MarkdownBlock from "./MarkdownBlock.svelte";

  export interface AskQuestion {
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

  // ── Helper functions (moved from Studio.svelte) ──

  function getToolLabel(name: string): string {
    const map: Record<string, string> = {
      Bash: "终端",
      Read: "读取文件",
      Write: "写入文件",
      Edit: "编辑文件",
      Grep: "搜索内容",
      Glob: "查找文件",
      WebSearch: "网页搜索",
      WebFetch: "获取网页",
      Skill: "技能",
      TodoWrite: "任务",
      Task: "子任务",
    };
    return map[name] ?? name;
  }

  function getToolAccent(name: string): string {
    const colors: Record<string, string> = {
      Bash: "#d97706",
      Read: "#2563eb",
      Write: "#7c3aed",
      Edit: "#7c3aed",
      Grep: "#059669",
      Glob: "#059669",
      WebSearch: "#0891b2",
      WebFetch: "#0891b2",
      Skill: "#c026d3",
      TodoWrite: "#ea580c",
      Task: "#ea580c",
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
      if (toolName === "Bash" && input.command) {
        return { type: "bash", content: input.command };
      }
      if (toolName === "Edit" && input.file_path) {
        return { type: "edit", content: "", filePath: input.file_path, oldStr: input.old_string ?? "", newStr: input.new_string ?? "" };
      }
      if ((toolName === "Read" || toolName === "Write") && input.file_path) {
        return { type: "file", content: input.file_path };
      }
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
      {#if block.evalData?.verdict === "pass"}
        <span class="eval-icon">&#x2713;</span>
      {:else if block.evalData?.verdict === "fail"}
        <span class="eval-icon">&#x2717;</span>
      {:else}
        <span class="eval-icon">&#x25CE;</span>
      {/if}
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
    <div class="block-label">You</div>
    <div class="block-content user-content">{block.text}</div>
  </div>

{:else if block.type === "thinking"}
  <!-- Thinking card -->
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
      <div class="thinking-card-body">
        <MarkdownBlock text={block.text} />
      </div>
    {/if}
  </div>

{:else if block.type === "tool_use"}
  <!-- Tool use card -->
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
          {#if fmt.oldStr}
            <pre class="diff-block diff-old">{fmt.oldStr}</pre>
          {/if}
          {#if fmt.newStr}
            <pre class="diff-block diff-new">{fmt.newStr}</pre>
          {/if}
        {:else if fmt.type === "file"}
          <div class="edit-file-path">{fmt.content}</div>
        {:else}
          <pre class="tool-code-block"><code>{fmt.content}</code></pre>
        {/if}
      </div>
    {/if}
  </div>

{:else if block.type === "tool_result"}
  <!-- Tool result card -->
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
          <button class="show-all-btn" onclick={() => onShowFull?.(index)}>
            显示全部 ({resultData.total} 行)
          </button>
        {/if}
        {#if showFullResult && block.text.split("\n").length > 15}
          <button class="show-all-btn" onclick={() => onHideFull?.(index)}>
            收起
          </button>
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
              {#if opt.description}
                <span class="opt-desc">{opt.description}</span>
              {/if}
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
    <div class="block-content text-content">
      <MarkdownBlock text={block.text} />
    </div>
  </div>
{/if}

<style>
  .stream-block { max-width: 100%; }

  .block-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 0.15rem;
  }

  .block-content { color: var(--text); }

  /* ── Step dividers ── */
  .step-divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1.5rem 0 1rem;
    padding: 0;
  }
  .divider-line {
    flex: 1;
    height: 2px;
    background: linear-gradient(90deg, var(--spark-red, #FE2C55), transparent);
    opacity: 0.35;
  }
  .divider-label {
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--spark-red, #FE2C55);
    letter-spacing: 0.08em;
    white-space: nowrap;
    padding: 0.3rem 1rem;
    border: 2px solid var(--spark-red, #FE2C55);
    border-radius: 6px;
    background: rgba(254, 44, 85, 0.06);
  }

  /* ── User messages ── */
  .user-block { align-self: flex-end; max-width: 70%; }
  .user-block .block-label { display: none; }
  .user-content {
    background: var(--bg-surface, #edeae5);
    color: var(--text);
    padding: 0.65rem 1rem;
    border-radius: 18px 18px 4px 18px;
    font-size: 0.85rem;
    line-height: 1.65;
    font-weight: 450;
    border: 1px solid var(--border);
  }

  /* ═══════════════════════════════════════════════════════════
     Tool / Thinking / Result Cards
     ═══════════════════════════════════════════════════════════ */

  .tool-card { --tc-accent: #78716c; }
  .tool-card.thinking-card { --tc-accent: #e47a9f; }
  .tool-card.result-card { --tc-accent: #a1a1aa; }
  .tool-card.result-error { --tc-accent: #ef4444; }

  .tool-card {
    border-radius: 20px;
    margin: 2px 0;
    border: none;
    background: transparent;
  }

  .text-block {
    margin: 0.6rem 0 0.15rem;
    padding: 0.2rem 0;
  }

  .tool-card-header {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--bg-surface, #edeae5);
    border: 1px solid var(--border);
    border-radius: 20px;
    color: var(--text-secondary, #57534e);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.74rem;
    padding: 0.35rem 0.75rem 0.35rem 0.5rem;
    text-align: left;
    transition: all 0.15s ease;
    min-height: 30px;
    width: auto;
  }

  .tool-card-header:hover {
    background: var(--bg-hover, #dfdbd5);
    border-color: var(--text-dim);
  }

  .tool-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--tc-accent);
    color: white;
    padding: 4px;
  }

  .tool-card-icon.thinking-icon {
    background: var(--tc-accent);
    color: white;
  }

  .tool-card-icon.result-icon {
    background: var(--tc-accent);
    color: white;
  }

  .tool-card-label {
    font-weight: 550;
    font-size: 0.74rem;
    color: var(--text-secondary, #57534e);
    flex-shrink: 0;
  }

  .result-label-text {
    color: var(--text-muted);
  }

  .tool-card-meta {
    font-size: 0.64rem;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .tool-card-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: 0.68rem;
    max-width: 300px;
  }

  .tool-card-preview.mono {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.66rem;
  }

  .tool-card-chevron {
    font-size: 0.6rem;
    color: var(--text-dim);
    flex-shrink: 0;
    width: 0.8rem;
    text-align: center;
    opacity: 0.5;
  }

  .thinking-card-body {
    padding: 0.65rem 0.85rem;
    font-size: 0.78rem;
    color: var(--text-secondary, var(--text-muted));
    max-height: 240px;
    overflow-y: auto;
    margin: 0.25rem 0 0.5rem;
    background: var(--bg-surface, #edeae5);
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .tool-card-body {
    padding: 0.5rem 0.65rem;
    margin: 0.25rem 0 0.5rem;
    background: var(--bg-surface, #edeae5);
    border: 1px solid var(--border);
    border-radius: 10px;
    max-height: 220px;
    overflow-y: auto;
  }

  .tool-code-block {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.72rem;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    padding: 0.4rem 0.6rem;
    background: var(--bg-inset, rgba(0, 0, 0, 0.05));
    border-radius: 8px;
    line-height: 1.55;
  }

  .bash-prompt {
    color: var(--tc-accent, #d97706);
    user-select: none;
    font-weight: 700;
  }

  .edit-file-path {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.68rem;
    color: var(--text-muted);
    padding: 0.2rem 0;
    margin-bottom: 0.25rem;
    font-weight: 500;
    opacity: 0.8;
  }

  .diff-block {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.7rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0.2rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    line-height: 1.5;
    max-height: 160px;
    overflow-y: auto;
  }

  .diff-old {
    background: rgba(239, 68, 68, 0.08);
    border-left: 3px solid #ef4444;
    color: var(--text);
  }

  .diff-new {
    background: rgba(34, 197, 94, 0.08);
    border-left: 3px solid #22c55e;
    color: var(--text);
  }

  .result-card-body {
    padding: 0.4rem 0.5rem;
    margin: 0.25rem 0 0.5rem;
    background: var(--bg-surface, #edeae5);
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .result-error .result-card-body {
    border-color: rgba(239, 68, 68, 0.2);
  }

  .result-pre {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.69rem;
    color: var(--text-secondary, var(--text));
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    max-height: 200px;
    overflow-y: auto;
    line-height: 1.45;
  }

  .show-all-btn {
    display: inline-block;
    background: none;
    border: none;
    color: var(--spark-red, #FE2C55);
    font-size: 0.68rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0.3rem 0;
    transition: opacity 0.12s;
    font-family: inherit;
  }

  .show-all-btn:hover {
    text-decoration: underline;
  }

  .result-header {}

  /* ── Text block content ── */
  .text-label { color: var(--spark-red, #FE2C55); font-size: 0.62rem; }
  .text-content {
    padding: 0;
    font-size: 0.88rem;
    line-height: 1.8;
    color: var(--text);
  }

  .fade-in {
    animation: fadeSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Ask question options ── */
  .ask-block { max-width: 90%; }

  .ask-question {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ask-header {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.5;
  }

  .ask-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .ask-option {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    background: var(--bg-surface);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    padding: 0.5rem 0.85rem;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: all 0.15s ease;
    min-width: 0;
  }

  .ask-option:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .ask-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .opt-label {
    font-size: 0.82rem;
    font-weight: 650;
    color: var(--text);
  }

  .opt-desc {
    font-size: 0.7rem;
    color: var(--text-dim);
    line-height: 1.35;
  }

  /* ── Evaluator styling ── */
  .msg-evaluator {
    border-left: 3px solid var(--amber, #f59e0b);
    background: color-mix(in srgb, var(--amber, #f59e0b) 5%, transparent);
    border-radius: 8px;
    margin: 4px 0;
    padding-left: 12px;
  }

  .eval-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: color-mix(in srgb, var(--amber, #f59e0b) 15%, transparent);
    color: var(--amber, #f59e0b);
    letter-spacing: 0.5px;
  }

  .eval-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0;
    padding: 0 8px;
  }

  .eval-divider-line {
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent);
  }

  .eval-divider-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--amber, #f59e0b);
    white-space: nowrap;
  }

  .eval-divider.eval-pass .eval-divider-line { background: color-mix(in srgb, #22c55e 30%, transparent); }
  .eval-divider.eval-pass .eval-divider-label { color: #22c55e; }
  .eval-divider.eval-fail .eval-divider-line { background: color-mix(in srgb, #ef4444 30%, transparent); }
  .eval-divider.eval-fail .eval-divider-label { color: #ef4444; }

  .eval-icon { font-size: 14px; font-weight: 700; }
</style>
