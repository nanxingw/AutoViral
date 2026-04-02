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
      Bash: "#d97706",       // warm amber
      Read: "#2563eb",       // blue
      Write: "#7c3aed",      // violet
      Edit: "#7c3aed",       // violet
      Grep: "#059669",       // emerald
      Glob: "#059669",       // emerald
      WebSearch: "#0891b2",  // cyan
      WebFetch: "#0891b2",   // cyan
      Skill: "#c026d3",      // fuchsia
      TodoWrite: "#ea580c",  // orange
      Task: "#ea580c",       // orange
    };
    return colors[name] ?? "#78716c"; // stone gray fallback
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

          {:else if block.type === "thinking"}
            <!-- Thinking card -->
            <div class="tool-card thinking-card" class:msg-evaluator={block.source === "evaluator"}>
              <button class="tool-card-header" onclick={() => toggleBlock(i, streamBlocks)}>
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
              <button class="tool-card-header" onclick={() => toggleBlock(i, streamBlocks)}>
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
            {@const resultData = showFullResult[i] ? { truncated: block.text, total: block.text.split("\n").length, wasTruncated: false } : truncateResult(block.text, 15)}
            <div class="tool-card result-card" class:result-error={hasError}>
              <button class="tool-card-header result-header" onclick={() => toggleBlock(i, streamBlocks)}>
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
                    <button class="show-all-btn" onclick={() => { showFullResult[i] = true; showFullResult = { ...showFullResult }; }}>
                      显示全部 ({resultData.total} 行)
                    </button>
                  {/if}
                  {#if showFullResult[i] && block.text.split("\n").length > 15}
                    <button class="show-all-btn" onclick={() => { showFullResult[i] = false; showFullResult = { ...showFullResult }; }}>
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
            <div class="stream-block text-block fade-in" class:msg-evaluator={block.source === "evaluator"}>
              {#if block.source === "evaluator"}
                <div class="block-label text-label"><span class="eval-badge">评审</span></div>
              {/if}
              <div class="block-content text-content">
                <MarkdownBlock text={block.text} />
              </div>
            </div>
          {/if}
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

  /* ── Step dividers — dramatic section breaks ── */
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
     Tool / Thinking / Result Cards — pill-style process indicators
     ═══════════════════════════════════════════════════════════ */

  /* Tool-type accent colors */
  .tool-card { --tc-accent: #78716c; /* neutral fallback */ }
  .tool-card.thinking-card { --tc-accent: #e47a9f; /* warm rose */ }
  .tool-card.result-card { --tc-accent: #a1a1aa; /* zinc */ }
  .tool-card.result-error { --tc-accent: #ef4444; /* red */ }

  .tool-card {
    border-radius: 20px;
    margin: 2px 0;
    border: none;
    background: transparent;
  }

  /* ── Agent text blocks — clean, spacious ── */
  .text-block {
    margin: 0.6rem 0 0.15rem;
    padding: 0.2rem 0;
  }

  /* ── Tool card header — pill with icon dot ── */
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

  /* Thinking card body */
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

  /* Tool card body */
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

  /* Result card body */
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
