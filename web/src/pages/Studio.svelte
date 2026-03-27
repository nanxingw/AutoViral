<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, type Work, fetchSharedAssets, uploadAsset, type AssetFile, toggleEvalMode, forcePassEval, retryWithGuidance } from "../lib/api";
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
    type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider" | "ask_question" | "eval_divider";
    text: string;
    toolName?: string;
    collapsed?: boolean;
    questions?: AskQuestion[];
    source?: "creator" | "evaluator";
    evalData?: { type: string; step?: string; attempt?: number; verdict?: string; scores?: Record<string, number>; issues?: any[] };
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

  // --- Evaluation state ---
  let evaluationMode = $state(false);
  let evalBlocked = $state<{ step: string; attempt: number } | null>(null);
  let guidanceText = $state("");

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

  // Sync evaluationMode from work data
  $effect(() => {
    if (work) {
      evaluationMode = (work as any).evaluationMode ?? false;
    }
  });

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (streaming) { streaming = false; showNextStep = true; }
    }, 60000);
  }

  // --- Evaluation handlers ---
  async function handleToggleEval() {
    if (!work) return;
    const result = await toggleEvalMode(workId);
    evaluationMode = result.evaluationMode;
  }

  async function handleForcePass() {
    if (!work || !evalBlocked) return;
    const stepKeys = Object.keys(work.pipeline);
    const idx = stepKeys.indexOf(evalBlocked.step);
    const nextStep = idx < stepKeys.length - 1 ? stepKeys[idx + 1] : undefined;
    await forcePassEval(workId, evalBlocked.step, nextStep);
    evalBlocked = null;
  }

  async function handleRetryWithGuidance() {
    if (!work || !evalBlocked || !guidanceText.trim()) return;
    await retryWithGuidance(workId, evalBlocked.step, guidanceText);
    evalBlocked = null;
    guidanceText = "";
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
    // Update pipeline step status to aborted
    if (work && currentStep && work.pipeline[currentStep]) {
      work.pipeline[currentStep].status = "aborted";
      work = { ...work };
    }
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
      const collapsed = type === "thinking" || type === "tool_use" || type === "tool_result";
      streamBlocks = [...streamBlocks, { type, text, toolName, collapsed }];
    }
    scrollToBottom();
  }

  function getThinkingGroup(startIdx: number, blocks: StreamBlock[]): { indices: number[] } {
    const thinkTypes = ["thinking", "tool_use", "tool_result"];
    const indices: number[] = [];
    for (let j = startIdx; j < blocks.length; j++) {
      if (thinkTypes.includes(blocks[j].type)) indices.push(j);
      else break;
    }
    return { indices };
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
        streaming = true;
        resetInactivityTimer();
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
            collapsed: b.collapsed ?? (b.type === "thinking" || b.type === "tool_use" || b.type === "tool_result"),
          }));
          scrollToBottom();
        }
        break;
      case "assistant_thinking":
        streaming = true;
        resetInactivityTimer();
        streamBlocks = [...streamBlocks, { type: "thinking", text: data.text ?? "", collapsed: true, source: data.source ?? undefined }];
        scrollToBottom();
        break;
      case "tool_use":
        streaming = true;
        activeToolName = data.name ?? "";
        resetInactivityTimer();
        if (data.name === "AskUserQuestion" && data.input?.questions) {
          streamBlocks = [...streamBlocks, { type: "ask_question", text: "", questions: data.input.questions }];
          scrollToBottom();
        } else {
          streamBlocks = [...streamBlocks, { type: "tool_use", text: JSON.stringify(data.input, null, 2) ?? "", toolName: data.name, source: data.source ?? undefined }];
          scrollToBottom();
        }
        break;
      case "tool_result":
        streaming = true;
        activeToolName = "";
        resetInactivityTimer();
        streamBlocks = [...streamBlocks, { type: "tool_result", text: data.content ?? "", collapsed: true, source: data.source ?? undefined }];
        scrollToBottom();
        break;
      case "assistant_text": {
        streaming = true;
        activeToolName = "";
        resetInactivityTimer();
        const source = data.source as "creator" | "evaluator" | undefined;
        const last = streamBlocks[streamBlocks.length - 1];
        if (last?.type === "text" && last.source === (source ?? undefined)) {
          last.text += data.text ?? "";
          streamBlocks = [...streamBlocks];
        } else {
          streamBlocks = [...streamBlocks, { type: "text", text: data.text ?? "", source: source ?? undefined }];
        }
        scrollToBottom();
        break;
      }
      case "eval_divider":
        streamBlocks = [...streamBlocks, {
          type: "eval_divider",
          text: data.type === "start"
            ? `评审开始 (第${data.attempt}轮)`
            : data.verdict === "pass" ? "评审通过" : "评审未通过",
          source: "evaluator",
          evalData: data,
        }];
        scrollToBottom();
        break;
      case "eval_blocked":
        evalBlocked = { step: data.step, attempt: data.attempt };
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

    // Don't auto-start any task when opening a draft — user decides when to start

    return () => {
      unsub();
      if (inactivityTimer) clearTimeout(inactivityTimer);
      // Leaving Studio = abort any running task on the server
      if (streaming) {
        fetch(`/api/works/${encodeURIComponent(workId)}/abort`, { method: "POST" }).catch(() => {});
      }
      wsConn?.close();
      wsConn = null;
      streaming = false;
      activeToolName = "";
    };
  });
</script>

<div class="studio-layout">
  <div class="studio-header">
    <div class="header-left-group">
      <button class="back-btn" onclick={() => {
        // Leaving aborts any running task
        if (streaming) handleAbort();
        onBack();
      }}>
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
      <div class="eval-toggle" title={evaluationMode ? "关闭质量评审" : "开启质量评审"}>
        <label class="toggle-switch">
          <input type="checkbox" checked={evaluationMode} onchange={handleToggleEval} />
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label">质量评审</span>
      </div>
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
        onSelectStep={(key) => { if (!streaming) triggerStep(key); }}
        canAdvance={showNextStep && !streaming}
      />
    </div>

    <!-- Center: Chat -->
    <div class="panel-main">
      <div class="stream-area" bind:this={scrollEl}>
        {#each streamBlocks as block, i}
          {#if block.type === "eval_divider"}
            <div class="eval-divider" class:eval-pass={block.evalData?.verdict === "pass"} class:eval-fail={block.evalData?.verdict === "fail"}>
              <span class="eval-divider-line"></span>
              <span class="eval-divider-label">
                {#if block.evalData?.verdict === "pass"}
                  <span class="eval-icon">✓</span>
                {:else if block.evalData?.verdict === "fail"}
                  <span class="eval-icon">✗</span>
                {:else}
                  <span class="eval-icon">◎</span>
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
          {:else if block.type === "thinking" || block.type === "tool_use" || block.type === "tool_result"}
            <!-- Only show toggle if previous block is not also a thinking-type -->
            {#if i === 0 || !["thinking", "tool_use", "tool_result"].includes(streamBlocks[i - 1]?.type)}
              {@const group = getThinkingGroup(i, streamBlocks)}
              {@const isEval = block.source === "evaluator"}
              <button class="stream-block thinking-toggle" class:msg-evaluator={isEval} onclick={() => { for (const idx of group.indices) toggleBlock(idx, streamBlocks); }}>
                <span class="toggle-icon">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
                <span class="t-label thinking-label">
                  {#if isEval}
                    <span class="eval-badge">评审</span>
                  {/if}
                  {lang === "zh" ? "思考中..." : "Thinking..."}
                </span>
              </button>
              {#if !block.collapsed}
                <div class="thinking-content">
                  {#each group.indices as gi}
                    {@const gb = streamBlocks[gi]}
                    {#if gb.type === "tool_use"}
                      <div class="inner-tool-label">
                        {#if gb.source === "evaluator"}<span class="eval-badge">评审</span>{/if}
                        {gb.toolName ?? "Tool"}
                      </div>
                      <pre class="inner-tool-pre">{gb.text}</pre>
                    {:else if gb.type === "tool_result"}
                      <pre class="inner-tool-pre">{gb.text}</pre>
                    {:else}
                      <MarkdownBlock text={gb.text} />
                    {/if}
                  {/each}
                </div>
              {/if}
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
            <div class="stream-block text-block" class:msg-evaluator={block.source === "evaluator"}>
              <div class="block-label text-label">
                {#if block.source === "evaluator"}
                  <span class="eval-badge">评审</span>
                {:else}
                  Agent
                {/if}
              </div>
              <div class="block-content text-content">
                <MarkdownBlock text={block.text} />
              </div>
            </div>
          {/if}
        {/each}

        {#if streaming && activeToolName}
          <div class="streaming-indicator tool-active">
            <div class="tool-spinner"></div>
            <span class="streaming-label">{toolDisplayName(activeToolName)}</span>
          </div>
        {/if}

        {#if streamBlocks.length === 0 && !streaming}
          <div class="empty-state">
            <p>{lang === "zh" ? "你想如何修改方案？" : "How would you like to modify the plan?"}</p>
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
            <button class="eval-btn eval-btn-pass" onclick={handleForcePass}>强制通过</button>
            <div class="eval-guidance-row">
              <input
                type="text"
                class="eval-guidance-input"
                placeholder="给出修改方向..."
                bind:value={guidanceText}
                onkeydown={(e) => { if (e.key === "Enter" && guidanceText.trim()) handleRetryWithGuidance(); }}
              />
              <button class="eval-btn eval-btn-retry" onclick={handleRetryWithGuidance} disabled={!guidanceText.trim()}>
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
            disabled={!sessionReady || (streaming && !aborted)}
            rows="1"
          ></textarea>
          {#if streaming && !aborted}
            <button class="send-btn abort-mode" onclick={handleAbort}>
              <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>
            </button>
          {:else if aborted}
            <button class="send-btn resume-mode" onclick={handleResume}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
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

    <!-- Right: Assets -->
    <div class="panel-right" class:panel-expanded={panelExpanded}>
      <button class="panel-expand-toggle" onclick={() => panelExpanded = !panelExpanded} title={panelExpanded ? "收起面板" : "展开面板"}>
        {#if panelExpanded}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        {/if}
      </button>
      <AssetPanel {workId} visible={true} refreshTrigger={assetRefresh} showOutput={showOutputTab} onEditAsset={handleEditAsset} topicHint={work?.topicHint ?? ""} />
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
  .result-toggle:hover { background: rgba(254, 44, 85, 0.04); }

  .toggle-icon { font-size: 0.7rem; width: 0.8rem; flex-shrink: 0; }
  .t-label { font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
  .thinking-label { color: var(--spark-red, #FE2C55); text-transform: none; letter-spacing: 0; opacity: 0.7; }
  .result-label { color: var(--spark-red, #FE2C55); opacity: 0.7; }
  .toggle-hint { color: var(--text-dim); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.6; }

  .thinking-content {
    background: rgba(254, 44, 85, 0.03);
    border-left: 2px solid rgba(254, 44, 85, 0.15);
    padding: 0.5rem 0.75rem;
    border-radius: 0 6px 6px 0;
    font-size: 0.76rem;
    color: var(--text-secondary);
    overflow-y: auto;
    min-height: 30vh;
  }

  .inner-tool-label {
    font-size: 0.68rem;
    font-weight: 650;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.2rem;
    margin-top: 0.4rem;
  }

  .inner-tool-pre {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.72rem;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    padding: 0.25rem 0;
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
    background: rgba(254, 44, 85, 0.03);
    border-left: 2px solid rgba(254, 44, 85, 0.15);
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

  .text-label { color: var(--spark-red, #FE2C55); }
  .text-content {
    padding: 0.55rem 0;
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
    align-items: center;
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

  .send-btn.abort-mode {
    color: var(--spark-red, #FE2C55);
    opacity: 1;
  }
  .send-btn.abort-mode:hover { opacity: 0.7; }

  .send-btn.resume-mode {
    color: var(--text);
    opacity: 1;
  }
  .send-btn.resume-mode:hover { opacity: 0.7; }

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

  /* Eval divider */
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

  /* Eval toggle — impeccable design: clean, readable on both light/dark themes */
  .eval-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 16px;
    padding: 6px 14px;
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.08);
    transition: all 0.2s ease;
  }

  .eval-toggle:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 22px;
    flex-shrink: 0;
  }

  .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }

  .toggle-slider {
    position: absolute;
    inset: 0;
    background: #ccc;
    border-radius: 11px;
    cursor: pointer;
    transition: background 0.25s ease;
  }

  .toggle-slider::before {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    bottom: 2px;
    background: white;
    border-radius: 50%;
    transition: transform 0.25s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch input:checked + .toggle-slider {
    background: #f59e0b;
  }

  .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(16px);
  }

  .toggle-label {
    font-size: 13px;
    color: #555;
    font-weight: 600;
    letter-spacing: 0.3px;
    user-select: none;
  }

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
