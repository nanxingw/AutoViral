<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, type Work, fetchSharedAssets, uploadAsset, type AssetFile, toggleEvalMode, forcePassEval, retryWithGuidance } from "../lib/api";
  import { createWorkWs } from "../lib/ws";
  import PipelineSteps from "../components/PipelineSteps.svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import AssetPanel from "../components/AssetPanel.svelte";
  import StreamBlockComponent from "../components/StreamBlock.svelte";
  import type { StreamBlockData, AskQuestion } from "../components/StreamBlock.svelte";

  // Local alias for backward compat within this file
  type StreamBlock = StreamBlockData;

  let { workId, onBack, initialPrompt = "" }: { workId: string; onBack: () => void; initialPrompt?: string } = $props();

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
  // aborted state removed — after stop, user just sends a new message
  let showTypeDropdown = $state(false);
  let showCategoryDropdown = $state(false);

  const pipelineTemplates: Record<string, Record<string, string>> = {
    "short-video": { research: "话题调研", plan: "分镜规划", assembly: "视频合成" },
    "image-text": { research: "话题调研", plan: "内容规划", assets: "图片生成", assembly: "图文排版" },
  };

  async function switchType(newType: string) {
    if (!work || work.type === newType) return;
    // Abort any running task
    if (streaming) handleAbort();
    // Rebuild pipeline: keep research status, reset everything else
    const researchStatus = work.pipeline["research"]?.status ?? "pending";
    const newPipeline: Record<string, any> = {};
    for (const [key, name] of Object.entries(pipelineTemplates[newType] ?? {})) {
      newPipeline[key] = { name, status: key === "research" ? researchStatus : "pending" };
    }
    work.type = newType as any;
    work.pipeline = newPipeline;
    work = { ...work };
    await fetch(`/api/works/${encodeURIComponent(workId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: newType, pipeline: newPipeline }),
    }).catch(() => {});
    // Auto-start from plan if research is done
    if (researchStatus === "done") {
      // Reconnect WS if needed
      if (!wsConn) wsConn = createWorkWs(workId, wsHandler);
      setTimeout(() => triggerStep("plan"), 300);
    }
  }

  async function switchCategory(newCat: string) {
    if (!work || work.contentCategory === newCat) return;
    // Abort any running task
    if (streaming) handleAbort();
    // Reset pipeline from plan onwards
    const keys = Object.keys(work.pipeline);
    for (const key of keys) {
      if (key !== "research") {
        work.pipeline[key].status = "pending";
      }
    }
    work.contentCategory = newCat as any;
    work = { ...work };
    const pipelineUpdate: Record<string, any> = {};
    for (const key of keys) {
      if (key !== "research") pipelineUpdate[key] = { status: "pending" };
    }
    await fetch(`/api/works/${encodeURIComponent(workId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentCategory: newCat, pipeline: pipelineUpdate }),
    }).catch(() => {});
    // Auto-start from plan if research is done
    if (work.pipeline["research"]?.status === "done") {
      if (!wsConn) wsConn = createWorkWs(workId, wsHandler);
      setTimeout(() => triggerStep("plan"), 300);
    }
  }
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Evaluation state ---
  let evaluationMode = $state(false);
  let evalBlocked = $state<{ step: string; attempt: number } | null>(null);
  let guidanceText = $state("");

  // --- Attachment system ---
  let rightPanelWidth = $state(480);

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
  // Auto-advance: immediately start next step when current one completes
  $effect(() => {
    if (showNextStep && !streaming && work?.pipeline) {
      const keys = Object.keys(work.pipeline);
      const currentIdx = keys.indexOf(currentStep);
      if (currentIdx >= 0 && currentIdx < keys.length - 1) {
        const nextKey = keys[currentIdx + 1];
        if (work.pipeline[nextKey]?.status === "pending") {
          triggerStep(nextKey);
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
    // Kill server-side CLI process (both creator and evaluator)
    fetch(`/api/works/${encodeURIComponent(workId)}/abort`, { method: "POST" }).catch(() => {});
    wsConn?.close();
    wsConn = null;
    streaming = false;
    activeToolName = "";
    showNextStep = false;
    // Set pipeline step back to active so user can send messages
    if (work && currentStep && work.pipeline[currentStep]) {
      work.pipeline[currentStep].status = "active";
      work = { ...work };
      // Send the FULL pipeline object to avoid overwriting other steps
      fetch(`/api/works/${encodeURIComponent(workId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline: work.pipeline }),
      }).catch(() => {});
    }
    streamBlocks = [...streamBlocks, { type: "step_divider", text: tt("abortedMessage") }];
    scrollToBottom();
    // Reconnect WS so user can send new messages immediately
    if (!wsConn) {
      wsConn = createWorkWs(workId, wsHandler);
    }
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

  function getToolLabel(name: string): string {
    const map: Record<string, string> = {
      Bash: "终端", Read: "读取文件", Write: "写入文件", Edit: "编辑文件",
      Grep: "搜索内容", Glob: "查找文件", WebSearch: "网页搜索", WebFetch: "获取网页",
      Skill: "技能", TodoWrite: "任务", Task: "子任务",
    };
    return map[name] ?? name;
  }

  // Track "show all" state for tool results by block index
  let showFullResult: Record<number, boolean> = $state({});

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
        // Only add divider if the last block isn't already a divider for this step
        const lastBlock = streamBlocks[streamBlocks.length - 1];
        if (!(lastBlock?.type === "step_divider" && lastBlock?.text === stepName)) {
          streamBlocks = [...streamBlocks, { type: "step_divider", text: stepName }];
        }
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

    // If we have an initial prompt (from new work creation), send it to start the pipeline
    if (initialPrompt && work?.pipeline) {
      const firstKey = Object.keys(work.pipeline)[0];
      if (firstKey) {
        currentStep = firstKey;
        streamBlocks = [
          { type: "user", text: initialPrompt },
          { type: "step_divider", text: work.pipeline[firstKey]?.name ?? firstKey },
        ];
        streaming = true;
        // Send via HTTP step trigger (creates CLI session + sends prompt)
        fetch(`/api/works/${encodeURIComponent(workId)}/step/${encodeURIComponent(firstKey)}`, { method: "POST" }).catch(() => {});
      }
    }

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

<svelte:window on:pointerdown={() => { showTypeDropdown = false; showCategoryDropdown = false; }} />
<div class="studio-layout">
  <div class="studio-header">
    <div class="header-left-group">
      <button class="back-btn" onclick={() => {
        if (streaming) {
          const msg = lang === "zh" ? "正在生成中，退出将中止当前任务。确认退出？" : "Content is being generated. Leaving will abort the task. Continue?";
          if (!confirm(msg)) return;
          handleAbort();
        }
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
        <div class="tag-dropdown-wrap">
          <button class="header-tag clickable" onclick={() => showTypeDropdown = !showTypeDropdown}>
            {work.type === "short-video" ? tt("shortVideo") : tt("imageText")}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {#if showTypeDropdown}
            <div class="tag-dropdown">
              {#each [["short-video", tt("shortVideo")], ["image-text", tt("imageText")]] as [val, label]}
                <button class="tag-option" class:active={work.type === val} onclick={() => {
                  switchType(val);
                  showTypeDropdown = false;
                }}>{label}</button>
              {/each}
            </div>
          {/if}
        </div>
        {#if work.contentCategory}
          <div class="tag-dropdown-wrap">
            <button class="header-tag clickable" onclick={() => showCategoryDropdown = !showCategoryDropdown}>
              {work.contentCategory === "anxiety" ? tt("categoryAnxiety") : work.contentCategory === "conflict" ? tt("categoryConflict") : work.contentCategory === "comedy" ? tt("categoryComedy") : work.contentCategory === "envy" ? tt("categoryEnvy") : work.contentCategory}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {#if showCategoryDropdown}
              <div class="tag-dropdown">
                {#each [["anxiety", tt("categoryAnxiety")], ["conflict", tt("categoryConflict")], ["comedy", tt("categoryComedy")], ["envy", tt("categoryEnvy")]] as [val, label]}
                  <button class="tag-option" class:active={work.contentCategory === val} onclick={() => {
                    switchCategory(val);
                    showCategoryDropdown = false;
                  }}>{label}</button>
                {/each}
              </div>
            {/if}
          </div>
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
          <StreamBlockComponent
            {block}
            index={i}
            {streaming}
            showFullResult={showFullResult[i] ?? false}
            onToggle={(idx) => toggleBlock(idx, streamBlocks)}
            onOptionClick={handleOptionClick}
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
            disabled={!sessionReady || streaming}
            rows="1"
          ></textarea>
          {#if streaming}
            <button class="send-btn abort-mode" onclick={handleAbort}>
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

    <!-- Resize handle -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="panel-resize-handle"
      onpointerdown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = rightPanelWidth;
        const onMove = (ev: PointerEvent) => {
          const delta = startX - ev.clientX;
          rightPanelWidth = Math.max(320, Math.min(900, startW + delta));
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
    ></div>

    <!-- Right: Assets -->
    <div class="panel-right" style="width: {rightPanelWidth}px;">
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

  .header-tag.clickable {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    background: none;
    font-family: inherit;
    transition: all 0.12s;
  }
  .header-tag.clickable:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .tag-dropdown-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .tag-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15));
    z-index: 100;
    min-width: 100px;
    padding: 0.2rem;
    animation: modalIn 0.1s ease;
  }

  .tag-option {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 500;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }
  .tag-option:hover { background: rgba(148,163,184,0.08); color: var(--text); }
  .tag-option.active { color: var(--spark-red, #FE2C55); font-weight: 650; }

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
    width: 180px;
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--border);
  }

  .panel-main {
    flex: 1;
    min-width: 320px;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .panel-right {
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    border-left: 1px solid var(--border);
  }

  .panel-resize-handle {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s;
    position: relative;
    z-index: 5;
  }
  .panel-resize-handle:hover,
  .panel-resize-handle:active {
    background: var(--spark-red, #FE2C55);
    opacity: 0.3;
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

  /* Responsive */
  @media (max-width: 1024px) {
    .panel-right { display: none; }
    .panel-expand-toggle { display: none; }
  }
  @media (max-width: 768px) {
    .panel-left { display: none; }
    .studio-body { border-radius: 12px; }
  }

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
