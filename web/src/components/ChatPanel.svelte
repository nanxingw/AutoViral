<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";
  import { fetchSharedAssets, uploadAsset, type AssetFile } from "../lib/api";
  import StreamBlockComponent from "./StreamBlock.svelte";
  import type { StreamBlockData } from "./StreamBlock.svelte";

  export interface ChatAttachment {
    name: string;
    url: string;
    category: string;
    size: number;
  }

  let {
    streamBlocks,
    streaming,
    activeToolName,
    evalBlocked,
    sessionReady,
    workId,
    assets = [],
    onSend,
    onAbort,
    onEvalForcePass,
    onEvalRetry,
    onOptionClick,
    onEditAsset,
  }: {
    streamBlocks: StreamBlockData[];
    streaming: boolean;
    activeToolName: string;
    evalBlocked: { step: string; attempt: number } | null;
    sessionReady: boolean;
    workId: string;
    assets?: string[];
    onSend: (payload: { text: string; attachments: ChatAttachment[] }) => void;
    onAbort: () => void;
    onEvalForcePass: () => void;
    onEvalRetry: (guidance: string) => void;
    onOptionClick: (label: string) => void;
    onEditAsset?: (assetName: string, assetUrl: string) => void;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  // --- Internal state ---
  let inputText = $state("");
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let showFullResult: Record<number, boolean> = $state({});
  let guidanceText = $state("");

  // --- Attachment state ---
  let attachments: ChatAttachment[] = $state([]);
  let showAssetPicker = $state(false);
  let pickerAssets: Record<string, AssetFile[]> = $state({});
  let pickerCategory = $state("characters");

  const CATS = [
    { key: "characters", label: "人物" }, { key: "scenes", label: "场景" },
    { key: "music", label: "音乐" }, { key: "templates", label: "模板" },
    { key: "branding", label: "品牌" }, { key: "general", label: "通用" },
  ];

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  // --- Scroll logic ---
  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  $effect(() => {
    void streamBlocks.length;
    scrollToBottom();
  });

  // --- Tool display names ---
  function toolDisplayName(name: string): string {
    const map: Record<string, string> = {
      WebSearch: tt("toolSearching"),
      WebFetch: tt("toolFetching"),
      Bash: tt("toolRunning"),
      Read: tt("toolReading"),
      Write: tt("toolWriting"),
      Edit: tt("toolEditing"),
      Grep: tt("toolGrepping"),
      Glob: tt("toolGlobbing"),
    };
    return map[name] ?? tt("toolDefault").replace("{name}", name);
  }

  function getToolLabel(name: string): string {
    const map: Record<string, string> = {
      Bash: "终端", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
      Grep: "搜索内容", Glob: "查找文件", WebSearch: "网页搜索", WebFetch: "获取网页",
      Skill: "技能", TodoWrite: "任务", Task: "子任务",
    };
    return map[name] ?? name;
  }

  // --- Block toggle ---
  function toggleBlock(idx: number) {
    streamBlocks[idx].collapsed = !streamBlocks[idx].collapsed;
    // Trigger reactivity in parent via mutation — parent owns streamBlocks array
  }

  // --- Input handling ---
  function autoResizeInput() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); }
  }

  function handleSend() {
    const text = inputText.trim();
    if (!text && attachments.length === 0) return;
    if (streaming) return;
    const fullText = text + formatAttachments();
    const payload = { text: fullText, attachments: [...attachments] };
    inputText = "";
    if (inputEl) { inputEl.value = ""; inputEl.style.height = "auto"; }
    attachments = [];
    showAssetPicker = false;
    onSend(payload);
    scrollToBottom();
  }

  function handleOptionClickInternal(label: string) {
    if (streaming) return;
    onOptionClick(label);
  }

  // --- Attachment functions ---
  function addAttachment(att: ChatAttachment) {
    if (!attachments.some(a => a.url === att.url)) {
      attachments = [...attachments, att];
    }
    showAssetPicker = false;
  }

  function removeAttachment(idx: number) {
    attachments = attachments.filter((_, i) => i !== idx);
  }

  function formatAttachments(): string {
    if (attachments.length === 0) return "";
    const lines = attachments.map(a => {
      const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
      const isImg = ["png","jpg","jpeg","gif","webp","svg"].includes(ext);
      const isAudio = ["mp3","wav","ogg","m4a","aac"].includes(ext);
      const isVideo = ["mp4","mov","webm"].includes(ext);
      const type = isImg ? "图片" : isAudio ? "音频" : isVideo ? "视频" : "文件";
      const sizeStr = a.size > 1024*1024 ? `${(a.size/1024/1024).toFixed(1)}MB` : `${Math.round(a.size/1024)}KB`;
      return `[附件: ${a.url} (${type}, ${sizeStr})]`;
    });
    return "\n\n" + lines.join("\n");
  }

  async function openPicker() {
    showAssetPicker = !showAssetPicker;
    if (showAssetPicker) {
      try { pickerAssets = await fetchSharedAssets(); } catch {}
    }
  }

  async function handleLocalUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    try {
      const result = await uploadAsset("general", input.files);
      for (const f of result.uploaded) {
        addAttachment({ name: f.name, url: f.url, category: f.category, size: f.size });
      }
    } catch {}
    input.value = "";
  }

  // --- Eval handlers ---
  function handleEvalRetry() {
    if (!guidanceText.trim()) return;
    onEvalRetry(guidanceText);
    guidanceText = "";
  }

  // Expose method for parent to set input text (e.g., from asset edit)
  export function setInputText(text: string) {
    inputText = text;
    requestAnimationFrame(() => { autoResizeInput(); inputEl?.focus(); });
  }
</script>

<div class="chat-panel-root">
  <div class="stream-area" bind:this={scrollEl}>
    {#each streamBlocks as block, i}
      <StreamBlockComponent
        {block}
        index={i}
        {streaming}
        showFullResult={showFullResult[i] ?? false}
        onToggle={() => toggleBlock(i)}
        onOptionClick={handleOptionClickInternal}
        onShowFull={(idx) => { showFullResult[idx] = true; showFullResult = { ...showFullResult }; }}
        onHideFull={(idx) => { showFullResult[idx] = false; showFullResult = { ...showFullResult }; }}
      />
    {/each}

    {#if streaming && activeToolName}
      <div class="streaming-indicator tool-active">
        <span class="pulse-dot"></span>
        <span class="streaming-tool-name">{getToolLabel(activeToolName)}</span>
        <span class="streaming-tool-detail">{toolDisplayName(activeToolName)}</span>
      </div>
    {:else if streaming && !activeToolName}
      <div class="streaming-indicator thinking-active">
        <span class="pulse-dot thinking-dot"></span>
        <span class="streaming-label">{lang === "zh" ? "思考中..." : "Thinking..."}</span>
      </div>
    {/if}
  </div>

  {#if evalBlocked}
    <div class="eval-blocked-panel">
      <div class="eval-blocked-header">
        <span class="eval-blocked-icon">⚠️</span>
        <span>评审已达最大迭代次数 ({evalBlocked.attempt}/3)</span>
      </div>
      <div class="eval-blocked-actions">
        <button class="eval-btn eval-btn-pass" onclick={onEvalForcePass}>强制通过</button>
        <div class="eval-guidance-row">
          <input
            type="text"
            class="eval-guidance-input"
            placeholder="给出修改方向..."
            bind:value={guidanceText}
            onkeydown={(e) => { if (e.key === "Enter" && guidanceText.trim()) handleEvalRetry(); }}
          />
          <button class="eval-btn eval-btn-retry" onclick={handleEvalRetry} disabled={!guidanceText.trim()}>
            重新尝试
          </button>
        </div>
      </div>
    </div>
  {/if}

  <div class="input-area" style="position: relative;">
    {#if attachments.length > 0}
      <div class="attachment-bar">
        {#each attachments as att, i}
          <span class="attachment-chip">
            <span class="att-icon">{att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ? '🖼' : att.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i) ? '🎵' : att.name.match(/\.(mp4|mov|webm)$/i) ? '🎬' : '📄'}</span>
            <span class="att-name">{att.name}</span>
            <button class="att-remove" onclick={() => removeAttachment(i)}>✕</button>
          </span>
        {/each}
      </div>
    {/if}

    {#if showAssetPicker}
      <div class="asset-picker-popover">
        <div class="picker-header">从素材库选择</div>
        <div class="picker-cats">
          {#each CATS as cat}
            <button class="picker-cat-btn" class:active={pickerCategory === cat.key} onclick={() => pickerCategory = cat.key}>
              {cat.label}
            </button>
          {/each}
        </div>
        <div class="picker-grid">
          {#each (pickerAssets[pickerCategory] ?? []) as asset}
            <button class="picker-item" onclick={() => addAttachment({ name: asset.name, url: `/api/shared-assets/${encodeURIComponent(asset.category)}/${encodeURIComponent(asset.name)}`, category: asset.category, size: asset.size })}>
              {#if asset.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)}
                <img src="/api/shared-assets/{encodeURIComponent(asset.category)}/{encodeURIComponent(asset.name)}" alt={asset.name} class="picker-thumb" />
              {:else}
                <span class="picker-icon">{asset.name.match(/\.(mp3|wav)$/i) ? '🎵' : '📄'}</span>
              {/if}
              <span class="picker-name">{asset.name}</span>
            </button>
          {/each}
          {#if (pickerAssets[pickerCategory] ?? []).length === 0}
            <div class="picker-empty">暂无素材</div>
          {/if}
        </div>
        <div class="picker-divider"></div>
        <label class="picker-upload">
          📤 从本地上传文件
          <input type="file" multiple hidden onchange={handleLocalUpload} />
        </label>
      </div>
    {/if}

    <div class="input-bar">
      <div class="input-wrapper">
        <button class="attach-btn" onclick={openPicker} title="附件">📎</button>
        <textarea
          class="msg-input"
          bind:this={inputEl}
          bind:value={inputText}
          onkeydown={handleKeydown}
          oninput={autoResizeInput}
          placeholder={tt("chatPlaceholder")}
          disabled={!sessionReady || streaming}
          rows="1"
        ></textarea>
        {#if streaming}
          <button class="send-btn abort-mode" onclick={onAbort}>
            <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>
          </button>
        {:else}
          <button class="send-btn" onclick={handleSend} disabled={!sessionReady || (!inputText.trim() && attachments.length === 0)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .chat-panel-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* ═══════════════════════════════════════════════════════════
     Stream area — the main chat canvas
     ═══════════════════════════════════════════════════════════ */
  .stream-area {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  /* ── Streaming Indicator — alive, energetic ── */
  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1rem;
    border-radius: 10px;
    margin: 0.25rem 0;
  }

  .streaming-indicator.tool-active {
    background: rgba(245, 158, 11, 0.05);
  }

  .streaming-indicator.thinking-active {
    background: rgba(254, 44, 85, 0.04);
  }

  .pulse-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--state-running, #f59e0b);
    flex-shrink: 0;
    animation: pulseGlow 1.5s ease-in-out infinite;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
  }

  .pulse-dot.thinking-dot {
    background: var(--spark-red, #FE2C55);
    box-shadow: 0 0 8px rgba(254, 44, 85, 0.4);
  }

  @keyframes pulseGlow {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.7); }
  }

  .streaming-tool-name {
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--state-running, #f59e0b);
    letter-spacing: -0.02em;
  }

  .streaming-tool-detail {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-dim);
  }

  .streaming-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--spark-red, #FE2C55);
    opacity: 0.7;
    letter-spacing: -0.01em;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Input bar */
  .input-bar {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated, var(--bg));
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 0;
    background: var(--bg-surface, var(--bg-inset));
    border: 1.5px solid var(--border);
    border-radius: 16px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  }
  .input-wrapper:focus-within {
    border-color: var(--spark-red, #FE2C55);
    box-shadow: 0 0 0 3px rgba(254, 44, 85, 0.08);
  }

  .msg-input {
    flex: 1;
    background: none;
    color: var(--text);
    border: none;
    padding: 0.75rem 1rem;
    font-size: 0.85rem;
    font-family: inherit;
    resize: none;
    line-height: 1.6;
    min-height: 44px;
    max-height: 180px;
    overflow-y: auto;
  }
  .msg-input:focus { outline: none; }
  .msg-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg-input::placeholder { color: var(--text-dim); }

  .send-btn {
    background: none;
    color: var(--text-muted);
    border: none;
    border-radius: 0 14px 14px 0;
    padding: 0.65rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.12s, transform 0.1s;
    flex-shrink: 0;
  }
  .send-btn:hover:not(:disabled) { color: var(--spark-red, #FE2C55); transform: scale(1.08); }
  .send-btn:disabled { opacity: 0.2; cursor: not-allowed; }

  .send-btn.abort-mode {
    color: var(--spark-red, #FE2C55);
    opacity: 1;
  }
  .send-btn.abort-mode:hover { opacity: 0.7; }

  /* Attachment system */
  .attachment-bar {
    display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }
  .attachment-chip {
    display: flex; align-items: center; gap: 0.25rem;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 0.2rem 0.4rem; font-size: 0.72rem;
  }
  .att-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att-remove { background: none; border: none; cursor: pointer; color: var(--text-dim); font-size: 0.65rem; padding: 0 0.15rem; }
  .att-remove:hover { color: var(--spark-red); }

  .attach-btn {
    background: none; border: none; cursor: pointer; font-size: 1.1rem; padding: 0.3rem;
    color: var(--text-muted); transition: color 0.15s;
  }
  .attach-btn:hover { color: var(--text); }

  .asset-picker-popover {
    position: absolute; bottom: 100%; left: 0; right: 0;
    background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.15); max-height: 280px; overflow: hidden;
    display: flex; flex-direction: column; z-index: 100;
  }
  .picker-header { font-size: 0.75rem; font-weight: 600; padding: 0.5rem 0.6rem; color: var(--text-muted); }
  .picker-cats { display: flex; gap: 0.2rem; padding: 0 0.5rem 0.4rem; flex-wrap: wrap; }
  .picker-cat-btn {
    font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px;
    background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer;
  }
  .picker-cat-btn.active { background: var(--spark-red); color: #fff; border-color: transparent; }
  .picker-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 0.3rem; padding: 0 0.5rem; overflow-y: auto; flex: 1; max-height: 160px;
  }
  .picker-item {
    display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
    padding: 0.3rem; border-radius: 6px; border: 1px solid transparent;
    background: none; cursor: pointer; color: var(--text);
  }
  .picker-item:hover { background: var(--bg-surface); border-color: var(--border); }
  .picker-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; }
  .picker-icon { font-size: 1.5rem; }
  .picker-name { font-size: 0.6rem; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .picker-empty { grid-column: 1/-1; text-align: center; color: var(--text-dim); font-size: 0.72rem; padding: 1rem; }
  .picker-divider { height: 1px; background: var(--border); margin: 0.3rem 0.5rem; }
  .picker-upload {
    display: flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.6rem;
    font-size: 0.72rem; color: var(--text-muted); cursor: pointer;
  }
  .picker-upload:hover { color: var(--text); }

  /* Eval blocked panel */
  .eval-blocked-panel {
    margin: 8px 16px;
    padding: 16px;
    border-radius: 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .eval-blocked-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #991b1b;
    margin-bottom: 12px;
  }

  .eval-blocked-icon { font-size: 18px; }

  .eval-blocked-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .eval-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .eval-btn-pass {
    background: #fef3c7;
    color: #92400e;
    width: fit-content;
    border: 1px solid #fcd34d;
  }

  .eval-btn-pass:hover { background: #fde68a; }

  .eval-guidance-row {
    display: flex;
    gap: 8px;
  }

  .eval-guidance-input {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: white;
    color: #333;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .eval-guidance-input:focus {
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
  }

  .eval-btn-retry {
    background: #f59e0b;
    color: white;
    white-space: nowrap;
  }

  .eval-btn-retry:hover { opacity: 0.9; }
  .eval-btn-retry:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
