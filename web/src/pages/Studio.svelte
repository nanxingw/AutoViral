<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, updateWorkApi, type Work } from "../lib/api";
  import { createWorkWs } from "../lib/ws";
  import PipelineSteps from "../components/PipelineSteps.svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import AssetPanel from "../components/AssetPanel.svelte";

  interface StreamBlock {
    type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider";
    text: string;
    toolName?: string;
    collapsed?: boolean;
  }

  let { workId, onBack }: { workId: string; onBack: () => void } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let work: Work | null = $state(null);
  let sessionReady = $state(false);
  let streaming = $state(false);
  let streamBlocks: StreamBlock[] = $state([]);
  let currentStep = $state("");
  let inputText = $state("");
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let wsConn: { send: (text: string) => void; close: () => void } | null = null;
  let showNextStep = $state(false);
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // Asset panel
  let showAssets = $state(false);
  let assetRefresh = $state(0);

  // Auto-run
  let autoRun = $state(false);
  let autoRunTimer: ReturnType<typeof setTimeout> | null = null;
  let autoRunningStep = $state("");
  let pipelineComplete = $state(false);

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (streaming) { streaming = false; showNextStep = true; }
    }, 15000);
  }

  function cancelAutoRun() {
    if (autoRunTimer) { clearTimeout(autoRunTimer); autoRunTimer = null; }
    autoRunningStep = "";
  }

  const statusLabels: Record<string, string> = {
    draft: "workDraft", creating: "workCreating", ready: "workReady",
    publishing: "workPublishing", published: "workPublished", failed: "workFailed",
  };

  function statusBadgeClass(s: string): string {
    if (s === "published") return "badge-success";
    if (s === "failed") return "badge-error";
    if (s === "creating" || s === "publishing") return "badge-running";
    return "badge-default";
  }

  function handleSend() {
    const text = inputText.trim();
    if (!text || !sessionReady || streaming) return;
    inputText = "";
    if (inputEl) inputEl.value = "";
    streamBlocks = [...streamBlocks, { type: "user", text }];
    streaming = true;
    showNextStep = false;
    cancelAutoRun();
    wsConn?.send(text);
    scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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

  function toggleBlock(idx: number) {
    streamBlocks[idx].collapsed = !streamBlocks[idx].collapsed;
    streamBlocks = [...streamBlocks];
  }

  function handleStepClick(stepKey: string) {
    currentStep = stepKey;
  }

  async function triggerStep(stepKey: string) {
    if (!work || streaming) return;
    currentStep = stepKey;
    showNextStep = false;
    const stepName = work.pipeline[stepKey]?.name ?? stepKey;
    streamBlocks = [...streamBlocks, { type: "step_divider", text: stepName }];
    streaming = true;
    autoRunningStep = "";
    try {
      await fetch(`/api/works/${encodeURIComponent(workId)}/step/${encodeURIComponent(stepKey)}`, { method: "POST" });
    } catch { /* failed */ }
    scrollToBottom();
  }

  function advancePipeline() {
    if (!work) return;
    work.pipeline[currentStep].status = "done";
    work.pipeline[currentStep].completedAt = new Date().toISOString();
    const keys = Object.keys(work.pipeline);
    const nextKey = keys.find(k => work!.pipeline[k].status === "pending");
    if (nextKey) {
      currentStep = nextKey;
      work.pipeline[nextKey].status = "active";
    } else {
      pipelineComplete = true;
    }
    work = { ...work };
    updateWorkApi(workId, { pipeline: work.pipeline }).catch(() => {});

    // Auto-run: trigger next step after 3s delay
    if (autoRun && nextKey && !pipelineComplete) {
      const stepName = work.pipeline[nextKey]?.name ?? nextKey;
      autoRunningStep = stepName;
      autoRunTimer = setTimeout(() => {
        autoRunningStep = "";
        triggerStep(nextKey);
      }, 3000);
    }
  }

  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });

    try {
      work = await fetchWork(workId);
      if (work?.pipeline) {
        const keys = Object.keys(work.pipeline);
        const activeKey = keys.find(k => work!.pipeline[k].status === "active");
        if (activeKey) currentStep = activeKey;
        else if (keys.length > 0) currentStep = keys[0];
        // Check if all done
        pipelineComplete = keys.every(k => work!.pipeline[k].status === "done");
      }
    } catch { /* fetch failed */ }

    wsConn = createWorkWs(workId, (event, data) => {
      switch (event) {
        case "session_ready":
          sessionReady = true;
          break;

        case "session_state":
          if (data.connected) sessionReady = true;
          if (data.history?.length && streamBlocks.length === 0) {
            const restored: StreamBlock[] = [];
            for (const h of data.history) {
              restored.push({ type: h.role === "user" ? "user" : "text", text: h.text });
            }
            streamBlocks = restored;
          }
          break;

        case "assistant_thinking":
          streaming = true;
          resetInactivityTimer();
          appendToLastBlock("thinking", data.text ?? "");
          break;

        case "tool_use":
          streaming = true;
          resetInactivityTimer();
          appendToLastBlock("tool_use", JSON.stringify(data.input, null, 2) ?? "", data.name);
          break;

        case "tool_result":
          streaming = true;
          resetInactivityTimer();
          appendToLastBlock("tool_result", data.content ?? "");
          break;

        case "assistant_text":
          streaming = true;
          resetInactivityTimer();
          appendToLastBlock("text", data.text ?? "");
          break;

        case "turn_complete":
          if (inactivityTimer) clearTimeout(inactivityTimer);
          streaming = false;
          showNextStep = true;
          if (data.result && !streamBlocks.some(b => b.type === "text")) {
            appendToLastBlock("text", data.result);
          }
          assetRefresh++;
          if (work && currentStep && work.pipeline[currentStep]) {
            advancePipeline();
          }
          scrollToBottom();
          break;

        case "cli_exited":
          if (inactivityTimer) clearTimeout(inactivityTimer);
          streaming = false;
          showNextStep = true;
          assetRefresh++;
          break;
      }
    });

    try {
      await startWorkSession(workId);
      if (work && currentStep && work.pipeline[currentStep]?.status === "pending") {
        work.pipeline[currentStep].status = "active";
        work = { ...work };
      }
    } catch { /* failed */ }

    return () => {
      unsub();
      wsConn?.close();
      cancelAutoRun();
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
      {#if pipelineComplete}
        <span class="status-badge badge-success">Pipeline Complete</span>
      {/if}
    </div>
    <div class="header-controls">
      <!-- Auto-run toggle -->
      <label class="toggle-label">
        <span class="toggle-text">Auto</span>
        <input type="checkbox" class="toggle-input" bind:checked={autoRun} onchange={() => { if (!autoRun) cancelAutoRun(); }} />
        <span class="toggle-switch" class:on={autoRun}></span>
      </label>
      <!-- Asset panel toggle -->
      <button class="icon-btn" class:active={showAssets} onclick={() => { showAssets = !showAssets; }} title="Assets">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>
      <!-- Session status -->
      {#if sessionReady}
        <span class="session-indicator ready">Ready</span>
      {:else}
        <span class="session-indicator connecting">Connecting...</span>
      {/if}
    </div>
  </div>

  <div class="studio-body">
    <div class="panel-left">
      <PipelineSteps
        pipeline={work?.pipeline ?? {}}
        contentType={work?.type ?? "short-video"}
        platforms={work?.platforms?.map(p => p.platform) ?? []}
        {currentStep}
        onStepClick={handleStepClick}
        onNextStep={triggerStep}
      />
    </div>

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
            <button class="stream-block thinking-toggle" onclick={() => toggleBlock(i)}>
              <span class="toggle-icon">{block.collapsed ? "▸" : "▾"}</span>
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
            <button class="stream-block result-toggle" onclick={() => toggleBlock(i)}>
              <span class="toggle-icon">{block.collapsed ? "▸" : "▾"}</span>
              <span class="t-label result-label">Result</span>
              {#if block.collapsed}
                <span class="toggle-hint">{block.text.slice(0, 60)}...</span>
              {/if}
            </button>
            {#if !block.collapsed}
              <pre class="result-content">{block.text}</pre>
            {/if}
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
          <div class="streaming-indicator">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        {/if}

        {#if streamBlocks.length === 0 && !streaming}
          <div class="empty-state"><p>{tt("studio")}</p></div>
        {/if}
      </div>

      <div class="input-bar">
        {#if autoRunningStep}
          <div class="auto-run-notice">Auto-running: {autoRunningStep}...</div>
        {:else}
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
            {tt("send")}
          </button>
        {/if}
      </div>
    </div>

    <AssetPanel {workId} visible={showAssets} refreshTrigger={assetRefresh} />
  </div>
</div>

<style>
  .studio-layout { display: flex; flex-direction: column; height: calc(100vh - 120px); min-height: 400px; }

  .studio-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0; margin-bottom: 0.5rem; gap: 0.75rem; }

  .back-btn { display: flex; align-items: center; gap: 0.35rem; background: none; border: 1px solid var(--border); color: var(--text-secondary); padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 550; font-family: inherit; cursor: pointer; transition: all 0.15s ease; flex-shrink: 0; }
  .back-btn:hover { color: var(--text); border-color: var(--text-dim); background: var(--bg-hover); }

  .header-center { display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0; }
  .studio-title { font-size: 1rem; font-weight: 650; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .status-badge { font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 9999px; white-space: nowrap; flex-shrink: 0; }
  .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); }
  .badge-error { background: rgba(251, 113, 133, 0.15); color: var(--error); }
  .badge-running { background: rgba(245, 158, 11, 0.15); color: var(--state-running); }
  .badge-default { background: var(--bg-surface); color: var(--text-muted); }

  .header-controls { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

  /* Auto-run toggle */
  .toggle-label { display: flex; align-items: center; gap: 0.35rem; cursor: pointer; }
  .toggle-text { font-size: 0.72rem; font-weight: 600; color: var(--text-dim); }
  .toggle-input { display: none; }
  .toggle-switch { width: 32px; height: 18px; background: var(--bg-surface); border-radius: 9px; position: relative; transition: background 0.2s; border: 1px solid var(--border); }
  .toggle-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; background: var(--text-dim); border-radius: 50%; transition: transform 0.2s; }
  .toggle-switch.on { background: var(--accent); border-color: var(--accent); }
  .toggle-switch.on::after { transform: translateX(14px); background: white; }

  /* Icon button */
  .icon-btn { background: none; border: 1px solid var(--border); border-radius: 8px; padding: 0.3rem; color: var(--text-dim); cursor: pointer; transition: all 0.15s; display: flex; }
  .icon-btn:hover { color: var(--text); border-color: var(--text-dim); }
  .icon-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(134, 120, 191, 0.08); }

  .session-indicator { font-size: 0.72rem; font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 9999px; }
  .session-indicator.ready { background: rgba(52, 211, 153, 0.12); color: var(--success); }
  .session-indicator.connecting { background: rgba(245, 158, 11, 0.12); color: var(--state-running); }

  .studio-body { display: flex; flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: var(--card-radius); overflow: hidden; background: var(--card-bg); backdrop-filter: var(--card-blur); -webkit-backdrop-filter: var(--card-blur); }
  .panel-left { width: 240px; flex-shrink: 0; overflow: hidden; border-right: 1px solid var(--border); }
  .panel-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  .stream-area { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .stream-block { max-width: 100%; }
  .block-label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.68rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.2rem; padding: 0 0.1rem; }
  .block-content { color: var(--text); }

  .step-divider { display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0; }
  .divider-line { flex: 1; height: 1px; background: var(--border); }
  .divider-label { font-size: 0.72rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }

  .user-block { align-self: flex-end; max-width: 70%; }
  .user-block .block-label { color: var(--accent); justify-content: flex-end; }
  .user-content { background: rgba(134, 120, 191, 0.12); padding: 0.55rem 0.85rem; border-radius: 14px 14px 4px 14px; font-size: 0.84rem; line-height: 1.65; }

  .thinking-toggle, .result-toggle { display: flex; align-items: center; gap: 0.35rem; background: none; border: none; color: var(--text-dim); cursor: pointer; font-family: inherit; font-size: 0.72rem; padding: 0.25rem 0.4rem; border-radius: 6px; transition: background 0.1s; width: 100%; text-align: left; }
  .thinking-toggle:hover { background: rgba(148, 163, 184, 0.08); }
  .result-toggle:hover { background: rgba(52, 211, 153, 0.05); }
  .toggle-icon { font-size: 0.7rem; width: 0.8rem; flex-shrink: 0; }
  .t-label { font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
  .result-label { color: var(--success); }
  .toggle-hint { color: var(--text-dim); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.6; }
  .thinking-content { background: rgba(148, 163, 184, 0.05); border-left: 2px solid rgba(148, 163, 184, 0.2); padding: 0.35rem 0.65rem; border-radius: 0 6px 6px 0; font-size: 0.76rem; color: var(--text-muted); max-height: 200px; overflow-y: auto; }

  .tool-label { color: var(--state-running); }
  .tool-content { background: rgba(245, 158, 11, 0.05); border-left: 2px solid rgba(245, 158, 11, 0.25); padding: 0.35rem 0.65rem; border-radius: 0 6px 6px 0; font-family: "SF Mono", "Fira Code", monospace; font-size: 0.73rem; color: var(--text-secondary); max-height: 120px; overflow-y: auto; margin: 0; white-space: pre-wrap; word-break: break-word; }

  .result-content { background: rgba(52, 211, 153, 0.04); border-left: 2px solid rgba(52, 211, 153, 0.2); padding: 0.35rem 0.65rem; border-radius: 0 6px 6px 0; font-family: "SF Mono", "Fira Code", monospace; font-size: 0.73rem; color: var(--text-secondary); max-height: 200px; overflow-y: auto; margin: 0; white-space: pre-wrap; word-break: break-word; }

  .text-label { color: var(--success); }
  .text-content { padding: 0.55rem 0.85rem; background: rgba(52, 211, 153, 0.05); border-radius: 14px 14px 14px 4px; }

  .streaming-indicator { display: flex; gap: 0.3rem; padding: 0.5rem 0.85rem; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--state-running); animation: bounce 1.4s ease-in-out infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }

  .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 0.9rem; }

  .input-bar { display: flex; align-items: flex-end; gap: 0.5rem; padding: 0.6rem 1rem; border-top: 1px solid var(--border); }
  .msg-input { flex: 1; background: var(--bg-inset); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 0.5rem 0.75rem; font-size: 0.82rem; font-family: inherit; resize: none; line-height: 1.5; transition: border-color 0.15s ease; }
  .msg-input:focus { outline: none; border-color: var(--accent); }
  .msg-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .send-btn { background: var(--accent-gradient); color: var(--accent-text); border: none; border-radius: 10px; padding: 0.5rem 1rem; font-size: 0.8rem; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s ease; }
  .send-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .auto-run-notice { flex: 1; text-align: center; padding: 0.65rem; font-size: 0.82rem; color: var(--state-running); font-weight: 600; animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  @media (max-width: 768px) { .panel-left { display: none; } .studio-body { border-radius: 12px; } }
</style>
