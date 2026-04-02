<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWork, startWorkSession, forcePassEval, retryWithGuidance, toggleEvalMode, type Work, type EvalResult } from "../lib/api";
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
    type: "thinking" | "tool_use" | "tool_result" | "text" | "user" | "step_divider" | "ask_question" | "eval_result";
    text: string;
    toolName?: string;
    collapsed?: boolean;
    questions?: AskQuestion[];
    source?: "creator" | "evaluator";
    evalResult?: EvalResult;
  }

  let { workId, onBack, initialPrompt = "" }: { workId: string; onBack: () => void; initialPrompt?: string } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  const STEP_I18N_MAP: Record<string, string> = {
    "material-search": "stepMaterialSearch",
    research: "stepResearch",
    plan: "stepPlan",
    assets: "stepAssets",
    assembly: "stepAssembly",
  };
  const IMAGE_TEXT_OVERRIDES: Record<string, string> = {
    plan: "stepPlanImageText",
    assembly: "stepAssemblyImageText",
  };
  function stepLabel(key: string): string {
    const ct = work?.contentType ?? "short-video";
    if (ct === "image-text" && IMAGE_TEXT_OVERRIDES[key]) return tt(IMAGE_TEXT_OVERRIDES[key]);
    if (STEP_I18N_MAP[key]) return tt(STEP_I18N_MAP[key]);
    return key;
  }

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
  let evalRetryGuidance = $state("");
  let evalEnabled = $state(true);
  let showEvalTooltip = $state(false);

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
    if (showNextStep && !streaming && !aborted && work?.pipeline) {
      // Don't auto-advance if current step is being evaluated or blocked
      const curStatus = work.pipeline[currentStep]?.status;
      if (curStatus === "evaluating" || curStatus === "eval_blocked") return;
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

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (streaming) { streaming = false; showNextStep = true; }
    }, 60000);
  }

  function handleOutputTitle(title: string) {
    if (!work || !title || title === work.title) return;
    // Only auto-set title once; skip if already locked
    if (work.titleLocked) return;
    work.title = title;
    work.titleLocked = true;
    work = { ...work };
    fetch(`/api/works/${encodeURIComponent(workId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, titleLocked: true }),
    }).catch(() => {});
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
    if (!text || streaming) return;
    inputText = "";
    if (inputEl) inputEl.value = "";
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

  function handleAbort() {
    // Kill server-side CLI process
    fetch(`/api/works/${encodeURIComponent(workId)}/abort`, { method: "POST" }).catch(() => {});
    wsConn?.close();
    wsConn = null;
    streaming = false;
    activeToolName = "";
    showNextStep = false;
    aborted = true;
    // Update pipeline step status to aborted (client + server)
    if (work && currentStep && work.pipeline[currentStep]) {
      work.pipeline[currentStep].status = "aborted";
      work = { ...work };
      fetch(`/api/works/${encodeURIComponent(workId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline: { [currentStep]: { status: "aborted" } } }),
      }).catch(() => {});
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
    streamBlocks = [...streamBlocks, { type: "step_divider", text: stepKey }];
    streaming = true;
    fetch(`/api/works/${encodeURIComponent(workId)}/step/${encodeURIComponent(stepKey)}`, { method: "POST" }).catch(() => {});
    scrollToBottom();
  }

  async function handleToggleEval() {
    const result = await toggleEvalMode(workId);
    evalEnabled = result.evaluationMode;
  }

  async function handleForcePass(evalResult: EvalResult) {
    if (!work) return;
    const stepKeys = Object.keys(work.pipeline);
    const currentIdx = stepKeys.indexOf(evalResult.step);
    const nextKey = currentIdx < stepKeys.length - 1 ? stepKeys[currentIdx + 1] : undefined;
    const result = await forcePassEval(workId, evalResult.step, nextKey);
    work.pipeline = result.pipeline;
    work = { ...work };
    showNextStep = true;
  }

  async function handleRetryWithGuidance(evalResult: EvalResult) {
    if (!work || !evalRetryGuidance.trim()) return;
    await retryWithGuidance(workId, evalResult.step, evalRetryGuidance);
    evalRetryGuidance = "";
    streaming = true;
    showNextStep = false;
  }

  function wsHandler(event: string, data: any) {
    if (event === "title_updated" && data.title && work) {
      work.title = data.title;
      work.titleLocked = true;
      work = { ...work };
      return;
    }
    if (event === "eval_start" && data.step) {
      streamBlocks = [...streamBlocks, { type: "step_divider", text: tt("evalReviewing") }];
      streaming = true;
      scrollToBottom();
      return;
    }
    if (event === "eval_complete" && data.result) {
      streaming = false;
      const result = data.result as EvalResult;
      streamBlocks = [...streamBlocks, { type: "eval_result", text: "", evalResult: result }];
      scrollToBottom();
      return;
    }
    if (event === "pipeline_updated" && data.pipeline && work) {
      work.pipeline = data.pipeline;
      if (data.title) { work.title = data.title; work.titleLocked = true; }
      work = { ...work };
      const activeKey = Object.keys(data.pipeline).find((k: string) => data.pipeline[k].status === "active");
      if (activeKey) {
        currentStep = activeKey;
        streaming = true;
        resetInactivityTimer();
        streamBlocks = [...streamBlocks, { type: "step_divider", text: activeKey }];
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
        if (data.source === "evaluator") {
          // Evaluator text — append with source marker
          const last = streamBlocks[streamBlocks.length - 1];
          if (last && last.type === "text" && last.source === "evaluator") {
            last.text += data.text ?? "";
            streamBlocks = [...streamBlocks];
          } else {
            streamBlocks = [...streamBlocks, { type: "text", text: data.text ?? "", source: "evaluator" }];
          }
          scrollToBottom();
        } else {
          appendToLastBlock("text", data.text ?? "");
        }
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
      if (work) {
        evalEnabled = work.evaluationMode ?? true;
        if (work.pipeline) {
          const keys = Object.keys(work.pipeline);
          const activeKey = keys.find(k => work!.pipeline[k].status === "active");
          if (activeKey) {
            currentStep = activeKey;
          } else if (keys.length > 0) {
            currentStep = keys[0];
          }
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
          { type: "step_divider", text: firstKey },
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

<div class="studio-layout">
  <div class="studio-header">
    <div class="header-left-group">
      <button class="back-btn" onclick={() => {
        if (streaming) {
          const msg = tt("confirmLeaveWhileGenerating");
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
        <span class="header-tag">{work.type === "short-video" ? tt("shortVideo") : tt("imageText")}</span>
        {#if work.contentCategory}
          <span class="header-tag">{work.contentCategory === "anxiety" ? tt("categoryAnxiety") : work.contentCategory === "conflict" ? tt("categoryConflict") : work.contentCategory === "comedy" ? tt("categoryComedy") : work.contentCategory === "envy" ? tt("categoryEnvy") : work.contentCategory}</span>
        {/if}
      {/if}
    </div>
    <div class="header-controls">
      <div class="eval-switch-row">
        <span class="eval-switch-label">{tt("evalReviewing")}</span>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="eval-info"
          onmouseenter={() => showEvalTooltip = true}
          onmouseleave={() => showEvalTooltip = false}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          {#if showEvalTooltip}
            <span class="eval-tooltip">{tt("evalTooltip")}</span>
          {/if}
        </span>
        <button class="switch" class:on={evalEnabled} onclick={handleToggleEval}>
          <span class="switch-thumb"></span>
        </button>
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
          {#if block.type === "step_divider"}
            <div class="step-divider">
              <span class="divider-line"></span>
              <span class="divider-label">{STEP_I18N_MAP[block.text] ? stepLabel(block.text) : block.text}</span>
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
              <button class="stream-block thinking-toggle" onclick={() => { for (const idx of group.indices) toggleBlock(idx, streamBlocks); }}>
                <span class="toggle-icon">{block.collapsed ? "\u25B8" : "\u25BE"}</span>
                <span class="t-label thinking-label">{lang === "zh" ? "思考中..." : "Thinking..."}</span>
              </button>
              {#if !block.collapsed}
                <div class="thinking-content">
                  {#each group.indices as gi}
                    {@const gb = streamBlocks[gi]}
                    {#if gb.type === "tool_use"}
                      <div class="inner-tool-label">{gb.toolName ?? "Tool"}</div>
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
          {:else if block.type === "eval_result" && block.evalResult}
            {@const er = block.evalResult}
            <div class="stream-block eval-result-block" class:eval-pass={er.verdict === "pass"} class:eval-fail={er.verdict === "fail"}>
              <div class="eval-header">
                <span class="eval-verdict-badge" class:pass={er.verdict === "pass"} class:fail={er.verdict === "fail"}>
                  {er.verdict === "pass" ? tt("evalPass") : tt("evalFail")}
                </span>
              </div>
              {#if Object.keys(er.scores).length > 0}
                <div class="eval-scores">
                  {#each Object.entries(er.scores) as [dim, score]}
                    <div class="score-row">
                      <span class="score-dim">{dim}</span>
                      <div class="score-bar-bg">
                        <div class="score-bar-fill" style="width: {(score as number) * 10}%;" class:score-low={(score as number) < 6} class:score-mid={(score as number) >= 6 && (score as number) < 7}></div>
                      </div>
                      <span class="score-value" class:score-low={(score as number) < 6}>{score}/10</span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if er.issues.length > 0}
                <div class="eval-issues">
                  {#each er.issues as issue}
                    <div class="issue-item issue-{issue.severity}">
                      <span class="issue-severity">{issue.severity === "critical" ? tt("evalSeverityCritical") : issue.severity === "major" ? tt("evalSeverityMajor") : tt("evalSeverityMinor")}</span>
                      <span>{issue.description}</span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if er.suggestions.length > 0}
                <div class="eval-suggestions">
                  {#each er.suggestions as s}
                    <div class="suggestion-item">{s}</div>
                  {/each}
                </div>
              {/if}
              {#if er.verdict === "fail"}
                <div class="eval-actions">
                  <button class="eval-btn eval-force-pass" onclick={() => handleForcePass(er)}>{tt("evalForcePass")}</button>
                  <div class="eval-retry-row">
                    <textarea class="eval-retry-input" bind:value={evalRetryGuidance} placeholder={tt("evalRetryPlaceholder")} rows="2"></textarea>
                    <button class="eval-btn eval-retry" onclick={() => handleRetryWithGuidance(er)} disabled={!evalRetryGuidance.trim()}>{tt("evalRetry")}</button>
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="stream-block text-block" class:evaluator-block={block.source === "evaluator"}>
              <div class="block-label text-label">{block.source === "evaluator" ? tt("evalReviewing") : "Agent"}</div>
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
        {:else if streaming && !activeToolName}
          <div class="streaming-indicator thinking-active">
            <div class="thinking-spinner"></div>
            <span class="streaming-label">{lang === "zh" ? "思考中..." : "Thinking..."}</span>
          </div>
        {/if}

      </div>

      <div class="input-bar">
        <div class="input-wrapper">
          <textarea
            class="msg-input"
            bind:this={inputEl}
            bind:value={inputText}
            onkeydown={handleKeydown}
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
            <button class="send-btn" onclick={handleSend} disabled={!sessionReady || !inputText.trim()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Right: Assets -->
    <div class="panel-right">
      <AssetPanel {workId} visible={true} refreshTrigger={assetRefresh} showOutput={showOutputTab} topicHint={work?.topicHint ?? ""} chatBlocks={streamBlocks} onTitleFound={handleOutputTitle} />
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
  }

  .panel-right {
    width: 320px;
    flex-shrink: 0;
    overflow: hidden;
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
  .streaming-indicator.thinking-active {
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    background: rgba(254, 44, 85, 0.04);
    border-radius: 10px;
    border: 1px solid rgba(254, 44, 85, 0.08);
  }
  .streaming-indicator.thinking-active .streaming-label {
    color: var(--spark-red, #FE2C55);
    opacity: 0.7;
  }
  .thinking-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(254, 44, 85, 0.15);
    border-top-color: var(--spark-red, #FE2C55);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
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

  /* Eval switch */
  .eval-switch-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .eval-switch-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-dim);
  }
  .eval-info {
    position: relative;
    display: flex;
    align-items: center;
    color: var(--text-dim);
    cursor: help;
  }
  .eval-tooltip {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 0.65rem;
    font-size: 0.68rem;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.45;
    white-space: normal;
    width: 220px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    pointer-events: none;
  }
  .switch {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }
  .switch.on { background: var(--spark-red, #FE2C55); }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .switch.on .switch-thumb { transform: translateX(16px); }

  /* Evaluator blocks */
  .evaluator-block {
    border-left: 2px solid #f59e0b;
    padding-left: 0.75rem;
    margin-left: 0.25rem;
  }
  .evaluator-block .block-label { color: #f59e0b; }

  /* Eval result card */
  .eval-result-block {
    background: var(--bg-surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .eval-result-block.eval-pass { border-color: rgba(34, 197, 94, 0.4); }
  .eval-result-block.eval-fail { border-color: rgba(239, 68, 68, 0.4); }

  .eval-header { display: flex; align-items: center; gap: 0.5rem; }
  .eval-verdict-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
  }
  .eval-verdict-badge.pass { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
  .eval-verdict-badge.fail { background: rgba(239, 68, 68, 0.15); color: #dc2626; }

  .eval-scores { display: flex; flex-direction: column; gap: 0.3rem; }
  .score-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; }
  .score-dim { width: 5rem; color: var(--text-muted); font-weight: 500; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score-bar-bg { flex: 1; height: 6px; background: var(--bg-inset); border-radius: 3px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 3px; background: #22c55e; transition: width 0.3s; }
  .score-bar-fill.score-low { background: #ef4444; }
  .score-bar-fill.score-mid { background: #f59e0b; }
  .score-value { font-weight: 650; font-variant-numeric: tabular-nums; min-width: 2.5rem; text-align: right; }
  .score-value.score-low { color: #ef4444; }

  .eval-issues { display: flex; flex-direction: column; gap: 0.25rem; }
  .issue-item { font-size: 0.74rem; line-height: 1.4; display: flex; gap: 0.4rem; align-items: baseline; }
  .issue-severity {
    font-size: 0.62rem; font-weight: 700; text-transform: uppercase; padding: 0.08rem 0.35rem; border-radius: 4px; flex-shrink: 0;
  }
  .issue-critical .issue-severity { background: rgba(239, 68, 68, 0.15); color: #dc2626; }
  .issue-major .issue-severity { background: rgba(245, 158, 11, 0.15); color: #d97706; }
  .issue-minor .issue-severity { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); }

  .eval-suggestions { display: flex; flex-direction: column; gap: 0.2rem; }
  .suggestion-item { font-size: 0.74rem; color: var(--text-muted); line-height: 1.4; padding-left: 0.75rem; position: relative; }
  .suggestion-item::before { content: "→"; position: absolute; left: 0; color: var(--text-dim); }

  .eval-actions { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.35rem; border-top: 1px solid var(--border); }
  .eval-btn {
    font-family: inherit; font-size: 0.78rem; font-weight: 600; padding: 0.4rem 0.85rem; border-radius: 8px; cursor: pointer; border: 1.5px solid var(--border); background: var(--bg-surface); color: var(--text); transition: all 0.12s;
  }
  .eval-btn:hover { background: var(--bg-hover); }
  .eval-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .eval-force-pass { align-self: flex-start; }
  .eval-retry { flex-shrink: 0; }
  .eval-retry-row { display: flex; gap: 0.4rem; align-items: flex-end; }
  .eval-retry-input {
    flex: 1; font-family: inherit; font-size: 0.78rem; padding: 0.4rem 0.65rem; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg-inset); color: var(--text); resize: none; line-height: 1.4;
  }
  .eval-retry-input:focus { outline: none; border-color: var(--text-muted); }
  .eval-retry-input::placeholder { color: var(--text-dim); }

  /* Responsive */
  @media (max-width: 1024px) {
    .panel-right { display: none; }
  }
  @media (max-width: 768px) {
    .panel-left { display: none; }
    .studio-body { border-radius: 12px; }
  }
</style>
