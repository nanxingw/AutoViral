<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, type Work, fetchSharedAssets, uploadAsset, type AssetFile } from "../lib/api";
  import { createWorkWs } from "../lib/ws";
  import PipelineSteps from "../components/PipelineSteps.svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import AssetPanel from "../components/AssetPanel.svelte";
  interface AskQuestion {
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }

  interface StreamBlock {
    type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider" | "ask_question";
    text: string;
    toolName?: string;
    collapsed?: boolean;
    questions?: AskQuestion[];
  }

  let { workId, onBack }: { workId: string; onBack: () => void } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let work: Work | null = $state(null);
  let sessionReady = $state(false);
  let streaming = $state(false);
  let streamBlocks: StreamBlock[] = $state([]);
  let activeToolName = $state("");  // tracks current tool being executed
  let currentStep = $state("");
  let inputText = $state("");
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let wsConn: { send: (text: string) => void; close: () => void } | null = null;
  let showNextStep = $state(false);
  let aborted = $state(false);
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Attachment system ---
  let panelExpanded = $state(false);

  function handleEditAsset(assetName: string, assetUrl: string) {
    const ext = assetName.split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["png","jpg","jpeg","gif","webp","svg"].includes(ext);
    const isVid = ["mp4","mov","webm"].includes(ext);
    const type = isImg ? "图片" : isVid ? "视频" : "文件";
    inputText = `请修改这个${type}素材「${assetName}」（${assetUrl}）：\n`;
    requestAnimationFrame(() => { autoResizeInput(); inputEl?.focus(); });
  }

  interface ChatAttachment {
    name: string;
    url: string;
    category: string;
    size: number;
  }

  let attachments: ChatAttachment[] = $state([]);
  let showAssetPicker = $state(false);

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

  let pickerAssets: Record<string, AssetFile[]> = $state({});
  let pickerCategory = $state("characters");

  const CATS = [
    { key: "characters", label: "人物" }, { key: "scenes", label: "场景" },
    { key: "music", label: "音乐" }, { key: "templates", label: "模板" },
    { key: "branding", label: "品牌" }, { key: "general", label: "通用" },
  ];

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

  // Derived: check if all steps done or any pending
  let allStepsDone = $derived(
    work?.pipeline ? Object.values(work.pipeline).every(s => s.status === "done" || s.status === "skipped") : false
  );
  let hasPendingWork = $derived(
    work?.pipeline ? Object.values(work.pipeline).some(s => s.status === "pending" || s.status === "active") : false
  );

  // Asset panel refresh
  let assetRefresh = $state(0);
  let showOutputTab = $state(false);

  // Auto-advance to next step when current step completes
  $effect(() => {
    if (showNextStep && !streaming && work?.pipeline) {
      const keys = Object.keys(work.pipeline);
      const currentIdx = keys.indexOf(currentStep);
      if (currentIdx >= 0 && currentIdx < keys.length - 1) {
        const nextKey = keys[currentIdx + 1];
        if (work.pipeline[nextKey]?.status === "pending") {
          setTimeout(() => triggerStep(nextKey), 800);
        }
      }
    }
  });

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (streaming) { streaming = false; showNextStep = true; }
    }, 60000);
  }

  function handleCanvasSend(text: string) {
    if (!text || streaming || !wsConn) return;
    streamBlocks = [...streamBlocks, { type: "user", text }];
    wsConn.send(text);
    streaming = true;
    showNextStep = false;
  }

  function handleSend() {
    const text = inputText.trim();
    if (!text && attachments.length === 0) return;
    if (streaming) return;
    const fullText = text + formatAttachments();
    inputText = "";
    if (inputEl) { inputEl.value = ""; inputEl.style.height = "auto"; }
    attachments = [];
    showAssetPicker = false;
    streamBlocks = [...streamBlocks, { type: "user", text: fullText }];
    streaming = true;
    showNextStep = false;
    wsConn?.send(fullText);
    scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); }
  }

  function autoResizeInput() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
  }

  function handleOptionClick(label: string) {
    if (streaming) return;
    inputText = label;
    handleSend();
  }

  function handleAbort() {
    wsConn?.close();
    wsConn = null;
    streaming = false;
    activeToolName = "";
    showNextStep = false;
    aborted = true;
    streamBlocks = [...streamBlocks, { type: "step_divider", text: tt("abortedMessage") }];
    scrollToBottom();
  }

  function handleResume() {
    if (!work || streaming) return;
    aborted = false;
    // Reconnect WS and re-trigger current step
    wsConn = createWorkWs(workId, wsHandler);
    setTimeout(() => {
      if (currentStep && work?.pipeline[currentStep]) {
        const status = work.pipeline[currentStep].status;
        if (status === "active" || status === "pending") {
          triggerStep(currentStep);
        }
      }
    }, 300);
  }

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

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  function appendToLastBlock(type: StreamBlock["type"], text: string, toolName?: string) {
    const last = streamBlocks[streamBlocks.length - 1];
    if (last && last.type === type && !toolName) {
      last.text += text;
      streamBlocks = [...streamBlocks];
    } else {
      const collapsed = type === "thinking" || type === "tool_result";
      streamBlocks = [...streamBlocks, { type, text, toolName, collapsed }];
    }
    scrollToBottom();
  }

  function toggleBlock(idx: number, blocks: StreamBlock[]) {
    blocks[idx].collapsed = !blocks[idx].collapsed;
    streamBlocks = [...streamBlocks];
  }

  // --- Check if a step's prerequisites are met ---

  function canStartStep(stepKey: string): boolean {
    if (!work) return false;
    const keys = Object.keys(work.pipeline);
    const idx = keys.indexOf(stepKey);
    if (idx <= 0) return true; // First step has no prerequisite
    // All preceding steps must be done or skipped
    for (let i = 0; i < idx; i++) {
      const s = work.pipeline[keys[i]];
      if (s.status !== "done" && s.status !== "skipped") return false;
    }
    return true;
  }

  // --- Trigger a pending step ---

  async function triggerStep(stepKey: string) {
    if (!work || streaming) return;
    if (!canStartStep(stepKey)) return;
    currentStep = stepKey;
    showNextStep = false;
    const stepName = work.pipeline[stepKey]?.name ?? stepKey;
    streamBlocks = [...streamBlocks, { type: "step_divider", text: stepName }];
    streaming = true;
    fetch(`/api/works/${encodeURIComponent(workId)}/step/${encodeURIComponent(stepKey)}`, { method: "POST" }).catch(() => {});
    scrollToBottom();
  }

  function wsHandler(event: string, data: any) {
    if (event === "pipeline_updated" && data.pipeline && work) {
      work.pipeline = data.pipeline;
      work = { ...work };
      const activeKey = Object.keys(data.pipeline).find((k: string) => data.pipeline[k].status === "active");
      if (activeKey) {
        currentStep = activeKey;
        const stepName = data.pipeline[activeKey]?.name ?? activeKey;
        streamBlocks = [...streamBlocks, { type: "step_divider", text: stepName }];
      }
      return;
    }

    switch (event) {
      case "session_ready":
        sessionReady = true;
        break;
      case "session_state":
        sessionReady = true;
        break;
      case "message_history":
        if (data.blocks && Array.isArray(data.blocks)) {
          streamBlocks = data.blocks.map((b: any) => ({
            type: b.type ?? "text",
            text: b.text ?? "",
            toolName: b.toolName,
            collapsed: b.collapsed ?? (b.type === "thinking" || b.type === "tool_result"),
          }));
          scrollToBottom();
        }
        break;
      case "assistant_thinking":
        streaming = true;
        resetInactivityTimer();
        appendToLastBlock("thinking", data.text ?? "");
        break;
      case "tool_use":
        streaming = true;
        activeToolName = data.name ?? "";
        resetInactivityTimer();
        if (data.name === "AskUserQuestion" && data.input?.questions) {
          streamBlocks = [...streamBlocks, { type: "ask_question", text: "", questions: data.input.questions }];
          scrollToBottom();
        } else {
          appendToLastBlock("tool_use", JSON.stringify(data.input, null, 2) ?? "", data.name);
        }
        break;
      case "tool_result":
        streaming = true;
        activeToolName = "";
        resetInactivityTimer();
        appendToLastBlock("tool_result", data.content ?? "");
        break;
      case "assistant_text":
        streaming = true;
        activeToolName = "";
        resetInactivityTimer();
        appendToLastBlock("text", data.text ?? "");
        break;
      case "turn_complete":
        if (inactivityTimer) clearTimeout(inactivityTimer);
        streaming = false;
        activeToolName = "";
        showNextStep = true;
        aborted = false;
        if (data.result) {
          const lastText = streamBlocks.filter(b => b.type === "text").pop();
          const resultTrimmed = data.result.trim();
          if (!lastText || !resultTrimmed.startsWith(lastText.text.trim().slice(0, 50))) {
            appendToLastBlock("text", data.result);
          }
        }
        assetRefresh++;
        showOutputTab = true;
        scrollToBottom();
        break;
      case "cli_exited":
        if (inactivityTimer) clearTimeout(inactivityTimer);
        streaming = false;
        showNextStep = true;
        assetRefresh++;
        break;
    }
  }

  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });

    try {
      work = await fetchWork(workId);
      if (work?.pipeline) {
        const keys = Object.keys(work.pipeline);
        const activeKey = keys.find(k => work!.pipeline[k].status === "active");
        if (activeKey) {
          currentStep = activeKey;
        } else if (keys.length > 0) {
          currentStep = keys[0];
        }
      }

    } catch { /* fetch failed */ }

    wsConn = createWorkWs(workId, wsHandler);

    // Auto-trigger if a step is already "active" (e.g. video-search created as active)
    if (work?.pipeline && currentStep && work.pipeline[currentStep]?.status === "active") {
      // Small delay to let WS connect first
      setTimeout(() => triggerStep(currentStep), 500);
    }

    return () => {
      unsub();
      wsConn?.close();
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
  });
</script>

<div class="studio-layout">
  <div class="studio-header">
    <div class="header-left-group">
      <button class="back-btn" onclick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        {tt("backToHome")}
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <h2
        class="studio-title"
        contenteditable="true"
        onblur={(e) => {
          const newTitle = (e.target as HTMLElement).textContent?.trim();
          if (newTitle && work && newTitle !== work.title) {
            work.title = newTitle;
            fetch(`/api/works/${encodeURIComponent(workId)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: newTitle }),
            }).catch(() => {});
          }
        }}
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
      >{work?.title ?? tt("studio")}</h2>
      {#if work}
        <span class="header-tag">{work.type === "short-video" ? tt("shortVideo") : tt("imageText")}</span>
        {#if work.contentCategory}
          <span class="header-tag">{work.contentCategory === "comedy" ? tt("categoryComedy") : work.contentCategory === "beauty" ? tt("categoryBeauty") : tt("categoryInfo")}</span>
        {/if}
      {/if}
    </div>
    <div class="header-controls">
      {#if aborted}
        <button class="resume-btn" onclick={handleResume}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {tt("resumeTask")}
        </button>
      {:else}
        <button class="abort-btn" onclick={handleAbort}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
          {tt("abortTask")}
        </button>
      {/if}
    </div>
  </div>

  <div class="studio-body">
    <!-- Left: Pipeline (~240px) -->
    <div class="panel-left">
      <PipelineSteps
        pipeline={work?.pipeline ?? {}}
        contentType={work?.type ?? "short-video"}
        platforms={work?.platforms ?? []}
        {currentStep}
        workTitle={work?.title ?? ""}
        topicHint={work?.topicHint ?? ""}
        onNextStep={triggerStep}
        canAdvance={showNextStep && !streaming}
      />
    </div>

    <!-- Center: Chat -->
    <div class="panel-main">
      <div class="stream-area" bind:this={scrollEl}>
        {#each streamBlocks as block, i}
          {#if block.type === "step_divider"}
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
            <button class="stream-block thinking-toggle" onclick={() => toggleBlock(i, streamBlocks)}>
              <span class="toggle-icon">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
              <span class="t-label">Thinking</span>
              {#if block.collapsed}
                <span class="toggle-hint">{block.text.slice(0, 50)}...</span>
              {/if}
            </button>
            {#if !block.collapsed}
              <div class="thinking-content"><MarkdownBlock text={block.text} /></div>
            {/if}
          {:else if block.type === "tool_use"}
            <div class="stream-block tool-block">
              <div class="block-label tool-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                {block.toolName ?? "Tool"}
              </div>
              <pre class="block-content tool-content">{block.text}</pre>
            </div>
          {:else if block.type === "tool_result"}
            <button class="stream-block result-toggle" onclick={() => toggleBlock(i, streamBlocks)}>
              <span class="toggle-icon">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
              <span class="t-label result-label">Result</span>
              {#if block.collapsed}
                <span class="toggle-hint">{block.text.slice(0, 60)}...</span>
              {/if}
            </button>
            {#if !block.collapsed}
              <pre class="result-content">{block.text}</pre>
            {/if}
          {:else if block.type === "ask_question" && block.questions}
            <div class="stream-block ask-block">
              {#each block.questions as q}
                <div class="ask-question">
                  <div class="ask-header">{q.question}</div>
                  <div class="ask-options">
                    {#each q.options as opt}
                      <button class="ask-option" onclick={() => handleOptionClick(opt.label)} disabled={streaming}>
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
            <div class="stream-block text-block">
              <div class="block-label text-label">Agent</div>
              <div class="block-content text-content">
                <MarkdownBlock text={block.text} />
              </div>
            </div>
          {/if}
        {/each}

        {#if streaming}
          <div class="streaming-indicator" class:tool-active={!!activeToolName}>
            {#if activeToolName}
              <div class="tool-spinner"></div>
              <span class="streaming-label">{toolDisplayName(activeToolName)}</span>
            {:else}
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            {/if}
          </div>
        {/if}

        {#if streamBlocks.length === 0 && !streaming}
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p>{tt("chatWithAgent")}</p>
          </div>
        {/if}
      </div>

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
          <button class="send-btn" onclick={handleSend} disabled={!sessionReady || streaming || (!inputText.trim() && attachments.length === 0)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
      </div>
    </div>

    <!-- Right: Assets -->
    <div class="panel-right" class:panel-expanded={panelExpanded}>
      <button class="panel-expand-toggle" onclick={() => panelExpanded = !panelExpanded} title={panelExpanded ? "收起面板" : "展开面板"}>
        {#if panelExpanded}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        {/if}
      </button>
      <AssetPanel {workId} visible={true} refreshTrigger={assetRefresh} showOutput={showOutputTab} onEditAsset={handleEditAsset} />
    </div>
  </div>
</div>

<style>
  .studio-layout {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 52px);
    min-height: 0;
    overflow: hidden;
  }

  /* Header */
  .studio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    gap: 0.75rem;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0;
  }

  .header-left-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.3rem 0;
    font-size: var(--size-sm, 0.8rem);
    font-weight: 500;
    font-family: var(--font-body, inherit);
    cursor: pointer;
    transition: color 0.12s;
    flex-shrink: 0;
  }
  .back-btn:hover { color: var(--text); }

  .studio-title {
    font-family: var(--font-display, inherit);
    font-size: var(--size-base, 0.88rem);
    font-weight: 600;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    outline: none;
    border-bottom: 1px solid transparent;
    cursor: text;
    transition: border-color 0.12s;
    padding-bottom: 1px;
  }

  .header-tag {
    font-size: var(--size-xs, 0.7rem);
    font-weight: 500;
    color: var(--text-dim);
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .abort-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border: none;
    border-radius: 4px;
    background: var(--spark-red, #FE2C55);
    color: #fff;
    font-family: var(--font-body, inherit);
    font-size: var(--size-xs, 0.7rem);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
    white-space: nowrap;
  }

  .abort-btn:hover {
    opacity: 0.85;
  }

  .resume-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border: none;
    border-radius: 4px;
    background: var(--text);
    color: var(--bg);
    font-family: var(--font-body, inherit);
    font-size: var(--size-xs, 0.7rem);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
    white-space: nowrap;
  }

  .resume-btn:hover {
    opacity: 0.85;
  }

  .studio-title:hover {
    border-color: var(--text-dim);
  }

  .studio-title:focus {
    border-color: var(--spark-red, #FE2C55);
  }

  /* Body: 3 panels */
  .studio-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .panel-left {
    width: 240px;
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--border);
  }

  .panel-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .panel-right {
    width: 320px;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    transition: width 0.25s ease;
  }

  .panel-right.panel-expanded {
    width: 520px;
  }

  .panel-expand-toggle {
    position: absolute;
    left: -16px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 16px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-right: none;
    border-radius: 6px 0 0 6px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s;
    padding: 0;
    opacity: 0.6;
  }

  .panel-expand-toggle:hover {
    color: var(--text);
    background: var(--accent-soft, rgba(254, 44, 85, 0.08));
    border-color: var(--accent, #FE2C55);
    opacity: 1;
  }

  /* Stream area */
  .stream-area {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stream-block { max-width: 100%; }

  .block-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.68rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.2rem;
    padding: 0 0.1rem;
  }

  .block-content { color: var(--text); }

  .step-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.75rem 0;
  }
  .divider-line { flex: 1; height: 1px; background: var(--border); }
  .divider-label {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .user-block { align-self: flex-end; max-width: 70%; }
  .user-block .block-label { color: var(--accent); justify-content: flex-end; }
  .user-content {
    background: rgba(0, 0, 0, 0.12);
    padding: 0.55rem 0.85rem;
    border-radius: 14px 14px 4px 14px;
    font-size: 0.84rem;
    line-height: 1.65;
  }

  .thinking-toggle, .result-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.72rem;
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    transition: background 0.1s;
    width: 100%;
    text-align: left;
  }
  .thinking-toggle:hover { background: rgba(148, 163, 184, 0.08); }
  .result-toggle:hover { background: rgba(52, 211, 153, 0.05); }

  .toggle-icon { font-size: 0.7rem; width: 0.8rem; flex-shrink: 0; }
  .t-label { font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
  .result-label { color: var(--success); }
  .toggle-hint { color: var(--text-dim); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.6; }

  .thinking-content {
    background: rgba(148, 163, 184, 0.05);
    border-left: 2px solid rgba(148, 163, 184, 0.2);
    padding: 0.35rem 0.65rem;
    border-radius: 0 6px 6px 0;
    font-size: 0.76rem;
    color: var(--text-muted);
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-label { color: var(--state-running); }
  .tool-content {
    background: rgba(245, 158, 11, 0.05);
    border-left: 2px solid rgba(245, 158, 11, 0.25);
    padding: 0.35rem 0.65rem;
    border-radius: 0 6px 6px 0;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.73rem;
    color: var(--text-secondary);
    max-height: 120px;
    overflow-y: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .result-content {
    background: rgba(52, 211, 153, 0.04);
    border-left: 2px solid rgba(52, 211, 153, 0.2);
    padding: 0.5rem 0.65rem;
    border-radius: 0 6px 6px 0;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.73rem;
    color: var(--text-secondary);
    max-height: 400px;
    min-height: 1.8em;
    overflow-y: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .text-label { color: var(--success); }
  .text-content {
    padding: 0.55rem 0.85rem;
    background: rgba(52, 211, 153, 0.05);
    border-radius: 14px 14px 14px 4px;
  }

  .streaming-indicator { display: flex; align-items: center; gap: 0.3rem; padding: 0.5rem 0.85rem; }
  .streaming-indicator.tool-active {
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    background: rgba(245, 158, 11, 0.06);
    border-radius: 10px;
    border: 1px solid rgba(245, 158, 11, 0.12);
  }
  .tool-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(245, 158, 11, 0.2);
    border-top-color: var(--state-running);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .streaming-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--state-running);
    letter-spacing: -0.01em;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--state-running); animation: bounce 1.4s ease-in-out infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    height: 100%;
    color: var(--text-dim);
    font-size: 0.88rem;
  }

  /* Input bar */
  .input-bar {
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border);
  }

  .input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 0;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: border-color 0.15s ease;
  }
  .input-wrapper:focus-within {
    border-color: var(--text-muted);
  }

  .msg-input {
    flex: 1;
    background: none;
    color: var(--text);
    border: none;
    padding: 0.6rem 0.85rem;
    font-size: 0.82rem;
    font-family: inherit;
    resize: none;
    line-height: 1.5;
    max-height: 150px;
    overflow-y: auto;
  }
  .msg-input:focus { outline: none; }
  .msg-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg-input::placeholder { color: var(--text-dim); }

  .send-btn {
    background: none;
    color: var(--text-muted);
    border: none;
    border-radius: 0 12px 12px 0;
    padding: 0.5rem 0.65rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.12s;
    flex-shrink: 0;
  }
  .send-btn:hover:not(:disabled) { color: var(--text); }
  .send-btn:disabled { opacity: 0.25; cursor: not-allowed; }

  /* AskUserQuestion options */
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

  /* Responsive */
  @media (max-width: 1024px) {
    .panel-right { display: none; }
    .panel-expand-toggle { display: none; }
  }
  @media (max-width: 768px) {
    .panel-left { display: none; }
    .studio-body { border-radius: 12px; }
  }
</style>
