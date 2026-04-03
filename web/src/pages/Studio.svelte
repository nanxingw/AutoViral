<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, type Work, toggleEvalMode, forcePassEval, retryWithGuidance } from "../lib/api";
  import { createWorkWs } from "../lib/ws";
  import PipelineBar from "../components/PipelineBar.svelte";
  import AssetSidebar from "../components/AssetSidebar.svelte";
  import ChatPanel from "../components/ChatPanel.svelte";
  import PreviewArea from "../components/PreviewArea.svelte";
  import ImageLayout from "../components/ImageLayout.svelte";
  import Timeline from "../components/Timeline.svelte";
  import type { ChatAttachment } from "../components/ChatPanel.svelte";
  import type { StreamBlockData } from "../components/StreamBlock.svelte";

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
  let wsConn: { send: (text: string) => void; close: () => void } | null = null;
  let showNextStep = $state(false);
  // aborted state removed — after stop, user just sends a new message
  let showTypeDropdown = $state(false);
  let showCategoryDropdown = $state(false);

  // 4-zone layout state
  let chatPanelWidth = $state(380);
  let timelineHeight = $state(220);
  let currentTime = $state(0);

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

  let chatPanelRef: ChatPanel | undefined = $state();

  function handleEditAsset(assetName: string, assetUrl: string) {
    const ext = assetName.split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["png","jpg","jpeg","gif","webp","svg"].includes(ext);
    const isVid = ["mp4","mov","webm"].includes(ext);
    const type = isImg ? "图片" : isVid ? "视频" : "文件";
    const text = `请修改这个${type}素材「${assetName}」（${assetUrl}）：\n`;
    chatPanelRef?.setInputText(text);
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

  // Asset sidebar state
  let assetFiles: string[] = $state([]);
  let selectedAsset: string | null = $state(null);

  // Helper to build asset URL
  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  // Video clips for Timeline
  let videoClips = $derived.by(() => {
    return assetFiles
      .filter(a => /\.(mp4|mov|webm)$/i.test(a) && !/final/i.test(a))
      .map((path, i) => ({
        id: `clip-${i}`,
        path,
        duration: 5,
        thumbnail: assetUrl(path),
      }));
  });

  // Audio/BGM info
  let audioInfo = $derived.by(() => {
    const bgm = assetFiles.find(a => /bgm/i.test(a) && /\.(mp3|wav|aac|m4a|ogg)$/i.test(a));
    if (!bgm) return null;
    return { path: bgm, name: bgm.split('/').pop() ?? bgm, duration: 0 };
  });

  // Images for ImageLayout
  let imageFiles = $derived.by(() => {
    return assetFiles
      .filter(a => /\.(png|jpe?g|webp|gif)$/i.test(a))
      .map((path, i) => ({ path, order: i }));
  });

  // Copytext (simplified)
  let parsedCopytext = $state<{ title: string; body: string; tags: string[]; topics: string[] } | null>(null);

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

  async function handleRetryWithGuidance(guidance: string) {
    if (!work || !evalBlocked || !guidance.trim()) return;
    await retryWithGuidance(workId, evalBlocked.step, guidance);
    evalBlocked = null;
  }

  function handleTimelineAction(type: string, payload: any) {
    const messages: Record<string, string> = {
      reorder: `请把视频片段重新排列为: ${Array.isArray(payload) ? payload.join(', ') : payload}`,
      delete: `请删除视频片段 ${payload?.target ?? payload}`,
      replace: `请重新生成视频片段 ${payload?.target ?? payload}`,
    };
    const text = messages[type] ?? `请调整视频: ${type}`;
    handleChatSend({ text, attachments: [] });
  }

  function handleImageAction(type: string, payload: any) {
    const messages: Record<string, string> = {
      reorder: `请把图片重新排列为: ${Array.isArray(payload) ? payload.join(', ') : payload}`,
      delete: `请删除图片 ${payload?.target ?? payload}`,
      replace: `请重新生成图片 ${payload?.target ?? payload}`,
      add: `请添加一张新图片`,
    };
    const text = messages[type] ?? `请调整图片: ${type}`;
    handleChatSend({ text, attachments: [] });
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
    const onMove = (ev: PointerEvent) => { timelineHeight = Math.max(150, Math.min(400, startH + (startY - ev.clientY))); };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleCanvasSend(text: string) {
    if (!text || streaming || !wsConn) return;
    streamBlocks = [...streamBlocks, { type: "user", text }];
    wsConn.send(text);
    streaming = true;
    showNextStep = false;
  }

  function handleChatSend(payload: { text: string; attachments: ChatAttachment[] }) {
    const { text } = payload;
    if (!text) return;
    if (streaming) return;
    streamBlocks = [...streamBlocks, { type: "user", text }];
    streaming = true;
    showNextStep = false;
    wsConn?.send(text);
    scrollToBottom();
  }

  function handleOptionClick(label: string) {
    if (streaming) return;
    // Directly send as if user typed it
    streamBlocks = [...streamBlocks, { type: "user", text: label }];
    streaming = true;
    showNextStep = false;
    wsConn?.send(label);
    scrollToBottom();
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

  // scrollToBottom is now handled internally by ChatPanel via $effect
  function scrollToBottom() {
    // no-op: ChatPanel auto-scrolls when streamBlocks changes
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

    // Poll asset list
    const fetchAssets = () =>
      fetch(`/api/works/${encodeURIComponent(workId)}/assets`)
        .then(r => r.ok ? r.json() : { assets: [] })
        .then((data: any) => { assetFiles = Array.isArray(data) ? data : (data.assets ?? []); })
        .catch(() => {});
    fetchAssets();
    const pollAssets = setInterval(fetchAssets, 5000);

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
      clearInterval(pollAssets);
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="timeline-resize-handle" onpointerdown={handleTimelineResize}></div>
      <div class="timeline-wrapper" style="height: {timelineHeight}px;">
        {#if work?.type === "short-video"}
          <Timeline
            clips={videoClips}
            audio={audioInfo}
            subtitles={[]}
            {currentTime}
            {workId}
            onReorder={(order) => handleTimelineAction("reorder", order)}
            onAction={(action) => handleTimelineAction(action.type, action)}
            onSeek={(t) => currentTime = t}
          />
        {:else}
          <ImageLayout
            images={imageFiles}
            copytext={parsedCopytext}
            {workId}
            onReorder={(order) => handleImageAction("reorder", order)}
            onSelect={(path) => selectedAsset = path}
            onAction={(action) => handleImageAction(action.type, action)}
          />
        {/if}
      </div>
    </div>

    <!-- Resize handle for chat width -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="panel-resize-handle" onpointerdown={handleChatResize}></div>

    <!-- Right: Chat Panel -->
    <div class="panel-right" style="width: {chatPanelWidth}px;">
      <ChatPanel
        bind:this={chatPanelRef}
        {streamBlocks}
        {streaming}
        {activeToolName}
        {evalBlocked}
        {sessionReady}
        {workId}
        onSend={handleChatSend}
        onAbort={handleAbort}
        onEvalForcePass={handleForcePass}
        onEvalRetry={handleRetryWithGuidance}
        onOptionClick={handleOptionClick}
        onEditAsset={handleEditAsset}
      />
    </div>
  </div>

  <PipelineBar
    pipeline={work?.pipeline ?? {}}
    {currentStep}
    {streaming}
    canAdvance={showNextStep && !streaming}
    onSelectStep={(key) => { if (!streaming) triggerStep(key); }}
  />
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

  /* Body: 4-zone layout */
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
    background: var(--bg-primary, #0A0A0F);
  }

  .timeline-wrapper {
    flex-shrink: 0;
    overflow: hidden;
    border-top: 1px solid var(--border);
  }

  .timeline-resize-handle {
    height: 5px;
    flex-shrink: 0;
    cursor: row-resize;
    background: transparent;
    transition: background 0.15s;
  }
  .timeline-resize-handle:hover,
  .timeline-resize-handle:active {
    background: var(--spark-red, #FE2C55);
    opacity: 0.3;
  }

  .panel-resize-handle {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s;
    z-index: 5;
  }
  .panel-resize-handle:hover,
  .panel-resize-handle:active {
    background: var(--spark-red, #FE2C55);
    opacity: 0.3;
  }

  .panel-right {
    flex-shrink: 0;
    overflow: hidden;
    border-left: 1px solid var(--border);
  }

  /* Responsive */
  @media (max-width: 1024px) {
    .panel-left { display: none; }
  }
  @media (max-width: 768px) {
    .panel-right { display: none; }
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

</style>
