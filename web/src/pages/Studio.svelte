<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, updateWorkApi, type Work } from "../lib/api";
  import { createWorkWs } from "../lib/ws";
  import PipelineSteps from "../components/PipelineSteps.svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import AssetPanel from "../components/AssetPanel.svelte";
  import CanvasWorkspace from "../components/CanvasWorkspace.svelte";

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

  type ViewMode = "live" | "review" | "pending";

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
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // View mode: review (read-only history), live (streaming), pending (not started)
  let viewMode: ViewMode = $state("live");
  let reviewBlocks: StreamBlock[] = $state([]);
  let reviewLoading = $state(false);

  // Track where current step's blocks start in streamBlocks
  let stepStartIndex = $state(0);

  // Derived: check if all steps done or any pending
  let allStepsDone = $derived(
    work?.pipeline ? Object.values(work.pipeline).every(s => s.status === "done" || s.status === "skipped") : false
  );
  let hasPendingWork = $derived(
    work?.pipeline ? Object.values(work.pipeline).some(s => s.status === "pending" || s.status === "active") : false
  );

  // Asset panel refresh
  let assetRefresh = $state(0);

  // Studio layout mode: "chat" (3-column with chat) or "canvas" (2-column with canvas workspace)
  type StudioMode = "chat" | "canvas";
  let studioMode: StudioMode = $state("chat");

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (streaming) { streaming = false; showNextStep = true; }
    }, 60000);
  }

  const statusLabels: Record<string, string> = {
    draft: "workDraft", creating: "workCreating", ready: "workReady", failed: "workFailed",
  };

  function statusBadgeClass(s: string): string {
    if (s === "ready") return "badge-success";
    if (s === "failed") return "badge-error";
    if (s === "creating") return "badge-running";
    return "badge-default";
  }

  function handleCanvasSend(text: string) {
    if (!text || streaming || !wsConn) return;
    streamBlocks = [...streamBlocks, { type: "user", text }];
    wsConn.send(text);
    streaming = true;
    showNextStep = false;
    if (studioMode === "canvas") {
      // Stay in canvas mode but ensure live view
      viewMode = "live";
    }
  }

  function handleSend() {
    const text = inputText.trim();
    if (!text || streaming) return;
    inputText = "";
    if (inputEl) inputEl.value = "";
    // Switch to live mode if we were in review/pending
    if (viewMode !== "live") {
      // Carry review history into live stream so user sees continuity
      if (reviewBlocks.length > 0) {
        streamBlocks = [...reviewBlocks];
        stepStartIndex = streamBlocks.length;
      }
      viewMode = "live";
      reviewBlocks = [];
    }
    streamBlocks = [...streamBlocks, { type: "user", text }];
    streaming = true;
    showNextStep = false;
    wsConn?.send(text);
    scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); }
  }

  function handleOptionClick(label: string) {
    if (streaming) return;
    inputText = label;
    handleSend();
  }

  function toolDisplayName(name: string): string {
    const map: Record<string, string> = {
      WebSearch: "正在搜索...",
      WebFetch: "正在获取网页...",
      Bash: "正在执行命令...",
      Read: "正在读取文件...",
      Write: "正在写入文件...",
      Edit: "正在编辑文件...",
      Grep: "正在搜索代码...",
      Glob: "正在查找文件...",
    };
    return map[name] ?? `正在执行 ${name}...`;
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
    if (viewMode === "review") {
      reviewBlocks = [...reviewBlocks];
    } else {
      streamBlocks = [...streamBlocks];
    }
  }

  // --- Step click: branch by status ---

  function handleStepClick(stepKey: string) {
    if (!work) return;
    const step = work.pipeline[stepKey];
    if (!step) return;
    currentStep = stepKey;

    if (step.status === "done") {
      // Review mode: load persisted history
      viewMode = "review";
      fetchStepHistory(stepKey);
    } else if (step.status === "active") {
      // Live mode: show current stream
      viewMode = "live";
      reviewBlocks = [];
    } else {
      // Pending: show empty state with trigger option
      viewMode = "pending";
      reviewBlocks = [];
    }
  }

  async function fetchStepHistory(stepKey: string) {
    reviewLoading = true;
    reviewBlocks = [];
    try {
      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/steps/${encodeURIComponent(stepKey)}/history`);
      if (res.ok) {
        const data = await res.json();
        reviewBlocks = (data.blocks ?? []).map((b: StreamBlock) => ({
          ...b,
          collapsed: b.type === "thinking" || b.type === "tool_result" ? true : b.collapsed,
        }));
      } else {
        reviewBlocks = [{ type: "text", text: lang === "zh" ? "暂无此步骤的执行记录。" : "No history available for this step." }];
      }
    } catch {
      reviewBlocks = [{ type: "text", text: lang === "zh" ? "加载失败。" : "Failed to load history." }];
    } finally {
      reviewLoading = false;
    }
  }

  function switchToLive() {
    const keys = work ? Object.keys(work.pipeline) : [];
    const activeKey = keys.find(k => work!.pipeline[k].status === "active");
    if (activeKey) {
      currentStep = activeKey;
      viewMode = "live";
    } else {
      // No active step — stay in review but select first step
      const lastDone = [...keys].reverse().find(k => work!.pipeline[k].status === "done");
      if (lastDone) currentStep = lastDone;
    }
    reviewBlocks = [];
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

  function handleStartStep(stepKey: string) {
    if (!work || streaming) return;
    if (!canStartStep(stepKey)) return;
    currentStep = stepKey;
    viewMode = "live";
    showNextStep = false;
    stepStartIndex = streamBlocks.length;
    const stepName = work.pipeline[stepKey]?.name ?? stepKey;
    streamBlocks = [...streamBlocks, { type: "step_divider", text: stepName }];
    streaming = true;
    fetch(`/api/works/${encodeURIComponent(workId)}/step/${encodeURIComponent(stepKey)}`, { method: "POST" }).catch(() => {});
    scrollToBottom();
  }

  async function triggerStep(stepKey: string) {
    if (!work) return;
    if (!canStartStep(stepKey)) return;
    // When user clicks "next step", finalize current step first
    if (currentStep && work.pipeline[currentStep]?.status === "active") {
      advancePipeline();
    }
    handleStartStep(stepKey);
  }

  // --- Conversation persistence (work-level, not step-level) ---

  /** Save ALL streamBlocks to a single chat.json per work. */
  async function saveChat() {
    if (streamBlocks.length === 0) return;
    try {
      await fetch(`/api/works/${encodeURIComponent(workId)}/chat`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: streamBlocks }),
      });
    } catch { /* best effort */ }
  }

  /** Load full conversation from chat.json on page open. */
  async function loadChat(): Promise<boolean> {
    try {
      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/chat`);
      if (res.ok) {
        const data = await res.json();
        if (data.blocks?.length) {
          streamBlocks = data.blocks;
          stepStartIndex = streamBlocks.length;
          return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  /** Also save step snapshot for review mode (called when user clicks "next step"). */
  async function saveStepSnapshot(stepKey: string, stepName: string) {
    const blocks = streamBlocks.slice(stepStartIndex);
    if (blocks.length === 0) return;
    try {
      await fetch(`/api/works/${encodeURIComponent(workId)}/steps/${encodeURIComponent(stepKey)}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey, stepName, completedAt: new Date().toISOString(), blocks }),
      });
    } catch { /* best effort */ }
  }

  /** Mark current step as done (save history + persist), but do NOT advance to next. */
  function markCurrentStepDone() {
    if (!work || !currentStep || !work.pipeline[currentStep]) return;
    if (work.pipeline[currentStep].status !== "active") return;

    const stepName = work.pipeline[currentStep].name ?? currentStep;
    saveStepSnapshot(currentStep, stepName);

    work.pipeline[currentStep].status = "done";
    work.pipeline[currentStep].completedAt = new Date().toISOString();
    work = { ...work };
    updateWorkApi(workId, { pipeline: work.pipeline }).catch(() => {});
  }

  /** Mark current step done AND advance to next step (called by user clicking "next step"). */
  function advancePipeline() {
    if (!work || !currentStep || !work.pipeline[currentStep]) return;
    if (work.pipeline[currentStep].status === "active") {
      const stepName = work.pipeline[currentStep].name ?? currentStep;
      saveStepSnapshot(currentStep, stepName); // Save step snapshot for review
      work.pipeline[currentStep].status = "done";
      work.pipeline[currentStep].completedAt = new Date().toISOString();
    }
    const keys = Object.keys(work.pipeline);
    const nextKey = keys.find(k => work!.pipeline[k].status === "pending");
    if (nextKey) {
      currentStep = nextKey;
      work.pipeline[nextKey].status = "active";
      stepStartIndex = streamBlocks.length;
      viewMode = "live";
    }
    work = { ...work };
    updateWorkApi(workId, { pipeline: work.pipeline }).catch(() => {});
    saveChat(); // Also save full conversation
  }

  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });

    try {
      work = await fetchWork(workId);
      if (work?.pipeline) {
        const keys = Object.keys(work.pipeline);
        const activeKey = keys.find(k => work!.pipeline[k].status === "active");
        const allDone = keys.every(k => work!.pipeline[k].status === "done" || work!.pipeline[k].status === "skipped");

        if (activeKey) {
          currentStep = activeKey;
          viewMode = "live";
        } else if (allDone && keys.length > 0) {
          currentStep = keys[keys.length - 1];
          viewMode = "review";
          fetchStepHistory(currentStep);
        } else if (keys.length > 0) {
          currentStep = keys[0];
          viewMode = "pending";
        }
      }

      // Always load full chat history from disk (survives refresh + server restart)
      const loaded = await loadChat();
      if (loaded && viewMode !== "review") {
        viewMode = "live"; // Show chat if history exists
      }
    } catch { /* fetch failed */ }

    wsConn = createWorkWs(workId, (event, data) => {
      // Pipeline updates are always processed regardless of view mode
      if (event === "pipeline_updated" && data.pipeline && work) {
        // Save snapshot of the step that just completed (before switching)
        const completedKey = Object.keys(data.pipeline).find((k: string) =>
          data.pipeline[k].status === "done" && work!.pipeline[k]?.status === "active"
        );
        if (completedKey) {
          const stepName = work.pipeline[completedKey]?.name ?? completedKey;
          saveStepSnapshot(completedKey, stepName);
        }

        work.pipeline = data.pipeline;
        work = { ...work };
        // Update currentStep to the new active step
        const activeKey = Object.keys(data.pipeline).find((k: string) => data.pipeline[k].status === "active");
        if (activeKey) {
          currentStep = activeKey;
          stepStartIndex = streamBlocks.length;
          viewMode = "live";
        }
        return;
      }

      // Only process stream events in live mode
      if (viewMode !== "live" && event !== "session_ready" && event !== "session_state" && event !== "cli_exited") return;

      switch (event) {
        case "session_ready":
          sessionReady = true;
          // Auto-switch to live if we were in pending and session started
          if (viewMode === "pending") viewMode = "live";
          break;

        case "session_state":
          // WebSocket connected — always allow sending (sendMessage will spawn CLI if needed)
          sessionReady = true;
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
            streamBlocks = [...streamBlocks, {
              type: "ask_question",
              text: "",
              questions: data.input.questions,
            }];
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
          // If the result contains text that wasn't already streamed via assistant_text,
          // check if the last block captured it. If not, append it.
          if (data.result) {
            const lastText = streamBlocks.filter(b => b.type === "text").pop();
            const resultTrimmed = data.result.trim();
            // Only append if result text wasn't already shown (avoid duplicating streamed content)
            if (!lastText || !resultTrimmed.startsWith(lastText.text.trim().slice(0, 50))) {
              appendToLastBlock("text", data.result);
            }
          }
          assetRefresh++;
          // Auto-save current step's blocks (persists across refresh/restart)
          saveChat();
          scrollToBottom();
          break;

        case "cli_exited":
          if (inactivityTimer) clearTimeout(inactivityTimer);
          streaming = false;
          showNextStep = true;
          assetRefresh++;
          saveChat();
          break;
      }
    });

    // Only auto-resume if step is already active (was running before page reload)
    // For pending steps, wait for user to manually click the step button
    const shouldAutoResume = work?.pipeline && currentStep &&
      work.pipeline[currentStep]?.status === "active";
    if (shouldAutoResume) {
      try {
        await startWorkSession(workId);
        viewMode = "live";
        stepStartIndex = streamBlocks.length;
      } catch { /* failed */ }
    }

    // Save on page unload (navigate away, close tab, refresh)
    function onBeforeUnload() { saveChat(); }
    window.addEventListener("beforeunload", onBeforeUnload);

    // Periodic auto-save every 10s while active
    const autoSaveInterval = setInterval(() => {
      if (streamBlocks.length > 0 && currentStep) saveChat();
    }, 10000);

    return () => {
      saveChat(); // Save when component unmounts
      clearInterval(autoSaveInterval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      unsub();
      wsConn?.close();
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
  });
</script>

<div class="studio-layout">
  <div class="studio-header">
    <button class="back-btn" onclick={onBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      {tt("backToHome")}
    </button>
    <div class="header-center">
      <h2 class="studio-title">{work?.title ?? tt("studio")}</h2>
      {#if work}
        <span class="status-badge {statusBadgeClass(work.status)}">{tt(statusLabels[work.status] ?? "workDraft")}</span>
      {/if}
    </div>
    <div class="header-controls">
      <div class="view-toggle">
        <button class="toggle-btn" class:active={studioMode === "chat"} onclick={() => studioMode = "chat"} title="对话模式">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="toggle-btn" class:active={studioMode === "canvas"} onclick={() => studioMode = "canvas"} title="画布模式">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </button>
      </div>
      {#if allStepsDone}
        <span class="session-indicator ready">{lang === "zh" ? "已完成" : "Completed"}</span>
      {:else if sessionReady}
        <span class="session-indicator ready">{tt("sessionReady")}</span>
      {:else if hasPendingWork}
        <span class="session-indicator connecting">{tt("sessionConnecting")}</span>
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
        onStepClick={handleStepClick}
        onNextStep={triggerStep}
        canAdvance={showNextStep && !streaming}
      />
    </div>

    <!-- Center: Chat / Review / Pending -->
    <div class="panel-main">
      {#if viewMode === "review"}
        <!-- REVIEW MODE: read-only history of a completed step -->
        <div class="review-banner">
          <div class="review-info">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>{lang === "zh" ? "查看记录" : "Reviewing"}: <strong>{work?.pipeline[currentStep]?.name ?? currentStep}</strong></span>
          </div>
          {#if work && Object.values(work.pipeline).some(s => s.status === "active")}
            <button class="back-to-live-btn" onclick={switchToLive}>
              {lang === "zh" ? "返回当前" : "Back to live"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          {/if}
        </div>
        <div class="stream-area" bind:this={scrollEl}>
          {#if reviewLoading}
            <div class="empty-state">
              <div class="mini-loader"></div>
            </div>
          {:else}
            {#each reviewBlocks as block, i}
              {#if block.type === "user"}
                <div class="stream-block user-block">
                  <div class="block-label">You</div>
                  <div class="block-content user-content">{block.text}</div>
                </div>
              {:else if block.type === "thinking"}
                <button class="stream-block thinking-toggle" onclick={() => toggleBlock(i, reviewBlocks)}>
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
                <button class="stream-block result-toggle" onclick={() => toggleBlock(i, reviewBlocks)}>
                  <span class="toggle-icon">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
                  <span class="t-label result-label">Result</span>
                  {#if block.collapsed}
                    <span class="toggle-hint">{block.text.slice(0, 60)}...</span>
                  {/if}
                </button>
                {#if !block.collapsed}
                  <pre class="result-content">{block.text}</pre>
                {/if}
              {:else if block.type === "step_divider"}
                <div class="step-divider">
                  <span class="divider-line"></span>
                  <span class="divider-label">{block.text}</span>
                  <span class="divider-line"></span>
                </div>
              {:else if block.type === "ask_question" && block.questions}
                <div class="stream-block ask-block">
                  {#each block.questions as q}
                    <div class="ask-question">
                      <div class="ask-header">{q.question}</div>
                      <div class="ask-options">
                        {#each q.options as opt}
                          <button class="ask-option" disabled>
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
          {/if}
        </div>
        <div class="input-bar">
          <textarea
            class="msg-input"
            bind:this={inputEl}
            bind:value={inputText}
            onkeydown={handleKeydown}
            placeholder={lang === "zh" ? "输入反馈..." : "Type feedback..."}
            disabled={streaming}
            rows="2"
          ></textarea>
          <button class="send-btn" onclick={handleSend} disabled={streaming || !inputText.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>

      {:else if viewMode === "pending"}
        <!-- PENDING MODE: step not started -->
        <div class="stream-area pending-area">
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <p>{lang === "zh" ? "此步骤尚未开始" : "This step has not started yet"}</p>
            {#if canStartStep(currentStep)}
              <button class="start-step-btn" onclick={() => handleStartStep(currentStep)} disabled={streaming}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                {lang === "zh" ? `开始${work?.pipeline[currentStep]?.name ?? ""}` : `Start ${work?.pipeline[currentStep]?.name ?? ""}`}
              </button>
            {:else}
              <p class="prereq-hint">{lang === "zh" ? "需要先完成前置步骤" : "Previous steps must be completed first"}</p>
            {/if}
          </div>
        </div>

      {:else}
        <!-- LIVE MODE: streaming agent interaction -->
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

        <div class="input-bar">
          <textarea
            class="msg-input"
            bind:this={inputEl}
            bind:value={inputText}
            onkeydown={handleKeydown}
            placeholder={tt("chatPlaceholder")}
            disabled={!sessionReady || streaming}
            rows="2"
          ></textarea>
          <button class="send-btn" onclick={handleSend} disabled={!sessionReady || streaming || !inputText.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      {/if}
    </div>

    <!-- Right: Assets (320px in chat mode) or Canvas (expanded) -->
    {#if studioMode === "canvas"}
      <div class="panel-canvas">
        <CanvasWorkspace {workId} visible={true} refreshTrigger={assetRefresh} onSendMessage={handleCanvasSend} />
      </div>
    {:else}
      <div class="panel-right">
        <AssetPanel {workId} visible={true} refreshTrigger={assetRefresh} />
      </div>
    {/if}
  </div>
</div>

<style>
  .studio-layout {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 3rem);
    min-height: 400px;
  }

  /* Header */
  .studio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    margin-bottom: 0.5rem;
    gap: 0.75rem;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 0.4rem 0.8rem;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 550;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .back-btn:hover { color: var(--text); border-color: var(--text-dim); background: var(--bg-hover); }

  .header-center {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: 1;
    min-width: 0;
  }

  .studio-title {
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-badge {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.15rem 0.55rem;
    border-radius: 9999px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); }
  .badge-error { background: rgba(251, 113, 133, 0.15); color: var(--error); }
  .badge-running { background: rgba(245, 158, 11, 0.15); color: var(--state-running); }
  .badge-default { background: var(--bg-surface); color: var(--text-muted); }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .session-indicator {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    border-radius: 9999px;
  }
  .session-indicator.ready { background: rgba(52, 211, 153, 0.12); color: var(--success); }
  .session-indicator.connecting { background: rgba(245, 158, 11, 0.12); color: var(--state-running); }

  /* Body: 3 panels */
  .studio-body {
    display: flex;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--card-radius);
    overflow: hidden;
    background: var(--card-bg);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .panel-left {
    width: 240px;
    flex-shrink: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }

  .panel-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .panel-right {
    width: 320px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .panel-canvas {
    flex: 1.5;
    min-width: 0;
    overflow: hidden;
    border-left: 1px solid var(--border);
  }

  /* View toggle */
  .view-toggle {
    display: flex;
    gap: 0.15rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 0.15rem;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover { color: var(--text-secondary); background: rgba(255, 255, 255, 0.04); }
  .toggle-btn.active { background: var(--accent-gradient); color: var(--accent-text); }

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
    background: rgba(134, 120, 191, 0.12);
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
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border);
  }

  .msg-input {
    flex: 1;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.55rem 0.85rem;
    font-size: 0.82rem;
    font-family: inherit;
    resize: none;
    line-height: 1.5;
    transition: border-color 0.15s ease;
  }
  .msg-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .msg-input:disabled { opacity: 0.5; cursor: not-allowed; }

  .send-btn {
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    border-radius: 12px;
    padding: 0.55rem;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .send-btn:hover:not(:disabled) { filter: brightness(1.15); transform: scale(1.05); }
  .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Review banner */
  .review-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: rgba(134, 120, 191, 0.08);
    border-bottom: 1px solid rgba(134, 120, 191, 0.15);
    flex-shrink: 0;
  }

  .review-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--accent);
    font-weight: 500;
  }

  .review-info strong { font-weight: 700; }

  .back-to-live-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 0.3rem 0.65rem;
    border-radius: 8px;
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .back-to-live-btn:hover {
    background: var(--accent-soft);
  }

  /* Pending state */
  .pending-area {
    align-items: center;
    justify-content: center;
  }

  .start-step-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    border-radius: 10px;
    padding: 0.6rem 1.2rem;
    font-size: 0.82rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-top: 0.5rem;
  }

  .start-step-btn:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .start-step-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

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

  .prereq-hint {
    font-size: 0.78rem;
    color: var(--text-dim);
    margin-top: 0.25rem;
  }

  /* Mini loader for review loading */
  .mini-loader {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Responsive */
  @media (max-width: 1024px) {
    .panel-right { display: none; }
  }
  @media (max-width: 768px) {
    .panel-left { display: none; }
    .studio-body { border-radius: 12px; }
  }
</style>
