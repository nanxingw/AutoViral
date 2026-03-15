<script lang="ts">
  import { onMount, tick } from "svelte";
  import { triggerEvolution } from "../lib/api";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let { workId, onBack }: { workId: string; onBack: () => void } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }
  let isNewWork = $derived(workId === "new");

  // Pipeline steps
  interface PipelineStep {
    id: number;
    nameKey: string;
    descKey: string;
    color: string;
  }

  const steps: PipelineStep[] = [
    { id: 1, nameKey: "step1_name", descKey: "step1_desc", color: "linear-gradient(135deg, #f59e0b, #ef4444)" },
    { id: 2, nameKey: "step2_name", descKey: "step2_desc", color: "linear-gradient(135deg, #ef4444, #ec4899)" },
    { id: 3, nameKey: "step3_name", descKey: "step3_desc", color: "linear-gradient(135deg, #8b5cf6, #6366f1)" },
    { id: 4, nameKey: "step4_name", descKey: "step4_desc", color: "linear-gradient(135deg, #10b981, #059669)" },
    { id: 5, nameKey: "step5_name", descKey: "step5_desc", color: "linear-gradient(135deg, #f59e0b, #d97706)" },
    { id: 6, nameKey: "step6_name", descKey: "step6_desc", color: "linear-gradient(135deg, #3b82f6, #8b5cf6)" },
  ];

  // Pipeline state
  type StepStatus = "pending" | "running" | "complete" | "paused";
  let stepStatuses: StepStatus[] = $state(steps.map(() => "pending"));
  let isRunning = $state(false);
  let isPaused = $state(false);
  let currentStep = $state(-1);
  let shouldStop = false;
  let allDone = $derived(stepStatuses.every(s => s === "complete"));
  let hasEverCompleted = $state(false);

  // Custom direction per step
  let stepDirections: string[] = $state(steps.map(() => ""));
  let showDirectionPanel: number | null = $state(null);

  // Track if user has made changes since last completion (for regen button)
  let hasChanges = $state(false);
  let canRegen = $derived(hasChanges && allDone && !isRunning);
  let saveMessage = $state("");

  function markChanged() {
    hasChanges = true;
  }

  function handleSaveDirections() {
    // Persist to localStorage
    const data = { directions: stepDirections, competitorUrls };
    localStorage.setItem(`cp-work-${workId}`, JSON.stringify(data));
    saveMessage = t("directionsSaved");
    setTimeout(() => { saveMessage = ""; }, 2000);
  }

  function loadSavedDirections() {
    try {
      const raw = localStorage.getItem(`cp-work-${workId}`);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.directions) stepDirections = data.directions;
        if (data.competitorUrls) competitorUrls = data.competitorUrls;
      }
    } catch {}
  }

  // Competitor URLs for step 3
  let competitorUrls: string[] = $state([]);
  let newUrl = $state("");
  let showCompetitorPanel = $state(false);

  // Strategy results - active report preview
  let activeReportKey: string | null = $state(null);

  // Existing work: expand/collapse steps
  let stepsExpanded = $state(false);

  // Mock deliverable data
  interface Deliverable {
    key: string;
    labelKey: string;
    content: string;
    contentZh: string;
    reportContent: string;
    reportContentZh: string;
  }

  const mockDeliverables: Deliverable[] = [
    {
      key: "title",
      labelKey: "resultTitle",
      content: "\"3 Things Your Competitors Don't Want You to Know About Short Video Growth\"",
      contentZh: "「你的竞品绝对不想让你知道的短视频涨粉 3 个秘密」",
      reportContent: "## Title Generation Report\n\nAnalyzed **47 competitor videos** across 3 platforms.\n\n### Key Findings\n- Numbered titles (\"3 things\", \"5 tips\") have **2.3x higher CTR**\n- Curiosity-gap titles outperform direct titles by 45%\n- Competitor mention increases engagement by 30%\n\n### Recommended Variants\n1. \"3 Things Your Competitors Don't Want You to Know\" *(top pick)*\n2. \"Why Your Competitor Gets 10x More Views\"\n3. \"The Growth Secret Nobody Talks About\"\n\n### Data Sources\n- Analyzed top 50 viral videos in your niche\n- Cross-referenced with your past 20 posts' performance\n- Applied A/B title patterns from 1,200+ tested headlines",
      reportContentZh: "## 标题生成报告\n\n在 3 个平台上分析了 **47 条竞品视频**。\n\n### 核心发现\n- 数字型标题（「3 个秘密」「5 个技巧」）**点击率高出 2.3 倍**\n- 悬念型标题比直白标题互动率高 45%\n- 提及竞品可提升 30% 互动量\n\n### 推荐标题方案\n1. 「你的竞品绝对不想让你知道的 3 个秘密」*（首选）*\n2. 「为什么你的竞品播放量是你的 10 倍」\n3. 「没有人会告诉你的涨粉秘诀」\n\n### 数据来源\n- 分析了你所在赛道 Top 50 爆款视频\n- 交叉对比了你最近 20 条内容的表现\n- 应用了 1,200+ 条 A/B 测试标题的规律",
    },
    {
      key: "copy",
      labelKey: "resultCopy",
      content: "Opening hook: \"You've been posting every day but your competitor barely posts and gets 10x your views...\" → Pain point → 3-part framework → CTA with urgency",
      contentZh: "开头钩子：「你每天发内容累死累活，竞品隔三差五发一条播放量却是你的 10 倍……」→ 痛点共鸣 → 三段式框架 → 紧迫感 CTA",
      reportContent: "## Copy & Script Report\n\n### Hook Analysis\nYour best-performing hooks use the **contrast pattern** — comparing effort vs. results.\n\n### Script Structure\n1. **Hook** (0-3s): Contrast statement\n2. **Problem** (3-10s): Why effort ≠ results\n3. **Framework** (10-45s): 3-part solution\n4. **CTA** (45-60s): Urgency + value promise\n\n### Word Choice Insights\n- \"Secret\" → +18% retention\n- \"Nobody\" → +22% engagement\n- \"Actually\" → builds trust\n\n### Estimated Performance\n- Predicted watch-through rate: 42% (your avg: 28%)\n- Predicted engagement rate: 8.5% (your avg: 4.2%)",
      reportContentZh: "## 文案脚本报告\n\n### 钩子分析\n你表现最好的钩子使用了**对比反差法** — 对比付出与结果的落差。\n\n### 脚本结构\n1. **钩子**（0-3 秒）：反差陈述\n2. **痛点**（3-10 秒）：为什么努力 ≠ 结果\n3. **框架**（10-45 秒）：三段式解法\n4. **行动号召**（45-60 秒）：紧迫感 + 价值承诺\n\n### 用词洞察\n- 「秘密」→ 完播率 +18%\n- 「没人告诉你」→ 互动率 +22%\n- 「其实」→ 建立信任感\n\n### 预估表现\n- 预计完播率：42%（你的均值：28%）\n- 预计互动率：8.5%（你的均值：4.2%）",
    },
    {
      key: "style",
      labelKey: "resultStyle",
      content: "Conversational + data-backed tone. Fast cuts every 3s. Text overlays on key stats. Your signature warm color grading. Background music: upbeat lo-fi.",
      contentZh: "对话式 + 数据驱动的表达风格。每 3 秒快切。关键数据叠加文字。你标志性的暖色调调色。背景音乐：轻快 lo-fi。",
      reportContent: "## Style Strategy Report\n\n### Your Signature Style DNA\nBased on analysis of your top 10 performing posts:\n- **Tone**: Conversational, slightly provocative\n- **Pacing**: Fast cuts every 2.8s average\n- **Visual**: Warm color grading (your signature look)\n\n### Competitor Style Gap\n| Element | You | Top Competitor | Opportunity |\n|---------|-----|---------------|-------------|\n| Cut pace | 2.8s | 2.1s | Speed up slightly |\n| Text overlays | Rare | Every key point | Add more |\n| Data visuals | None | Frequent | Big opportunity |\n\n### Recommendations\n1. Add text overlays on statistics\n2. Keep your warm color grading (distinctive)\n3. Increase cut frequency to ~2.3s\n4. Add subtle background music (lo-fi beat)",
      reportContentZh: "## 风格策略报告\n\n### 你的标志性风格 DNA\n基于你表现最好的 10 条内容分析：\n- **语气**：对话式，略带挑衅\n- **节奏**：平均每 2.8 秒一次快切\n- **视觉**：暖色调调色（你的标志性风格）\n\n### 竞品风格差距\n| 元素 | 你 | 头部竞品 | 机会点 |\n|------|-----|---------|--------|\n| 剪辑节奏 | 2.8 秒 | 2.1 秒 | 适当加快 |\n| 文字叠加 | 很少 | 每个要点 | 增加使用 |\n| 数据可视化 | 无 | 频繁 | 大机会 |\n\n### 建议\n1. 在关键数据上叠加文字\n2. 保持你的暖色调（辨识度高）\n3. 剪辑频率提高到约 2.3 秒\n4. 添加轻快背景音乐（lo-fi 节拍）",
    },
    {
      key: "publishTime",
      labelKey: "resultPublishTime",
      content: "Best window: Tuesday 7:30 PM — 8:30 PM. Secondary: Thursday 12:00 PM. Avoid weekends for this topic category.",
      contentZh: "最佳时段：周二 19:30 — 20:30。次选：周四 12:00。此类话题建议避开周末发布。",
      reportContent: "## Publish Time Report\n\n### Optimal Windows\n\n**Primary**: Tuesday 19:30 - 20:30\n- Your audience online peak: 87% active\n- Competition posting density: Low\n- Historical best performance day\n\n**Secondary**: Thursday 12:00 - 13:00\n- Lunch-break browsing spike\n- 72% audience active\n\n### Avoid\n- Weekends: Your niche audience engagement drops 40%\n- Monday mornings: High competition, low attention\n\n### Data Basis\n- Analyzed your last 30 posts' time-performance correlation\n- Cross-referenced with platform-wide engagement heatmaps\n- Factored in competitor posting schedules to find low-competition slots",
      reportContentZh: "## 发布时间报告\n\n### 最优时段\n\n**首选**：周二 19:30 - 20:30\n- 你的受众在线高峰：87% 活跃\n- 竞品发布密度：低\n- 你历史上表现最好的日子\n\n**次选**：周四 12:00 - 13:00\n- 午休刷手机高峰\n- 72% 受众活跃\n\n### 避免\n- 周末：你的赛道受众互动下降 40%\n- 周一早上：竞争激烈，注意力分散\n\n### 数据依据\n- 分析了你最近 30 条内容的时间-表现相关性\n- 交叉对比了全平台互动热力图\n- 考虑了竞品发布时间表以寻找低竞争窗口",
    },
    {
      key: "memory",
      labelKey: "resultMemory",
      content: "Applied: You prefer direct communication style (learned from 12 sessions). Your audience responds best to data-driven content (3 past successes). Avoided: tutorial format (low engagement in your history).",
      contentZh: "已应用：你偏好直接了当的表达风格（来自 12 次对话学习）。你的受众对数据驱动型内容反应最好（3 次成功经验）。已规避：教程类格式（你的历史数据显示互动低）。",
      reportContent: "## Memory Insights Report\n\n### Applied User Preferences\nThese insights were accumulated from observing your behavior across **12 sessions** over **3 weeks**:\n\n1. **Communication Style**: Direct and slightly provocative\n   - *Source*: Confirmed across 5 sessions, 2+ weeks\n   - *Application*: Hook uses confrontational tone\n\n2. **Content Preference**: Data-driven arguments\n   - *Source*: 3 successful posts featured statistics\n   - *Application*: Script includes specific numbers and %\n\n3. **Avoided Patterns**: Tutorial/how-to format\n   - *Source*: Your last 2 tutorials underperformed by 60%\n   - *Application*: Used story-driven structure instead\n\n### Confidence Level\n- High confidence (graduated knowledge): Communication style, data preference\n- Medium confidence (accumulating): Audience demographic assumptions\n- Excluded (stale): Old posting frequency preferences (60+ days old)",
      reportContentZh: "## 记忆洞察报告\n\n### 已应用的用户偏好\n以下洞察来自对你 **3 周** 内 **12 次对话** 行为的观察积累：\n\n1. **表达风格**：直接，略带挑衅\n   - *来源*：跨 5 次对话、2 周以上确认\n   - *应用*：钩子采用对抗性语气\n\n2. **内容偏好**：数据驱动型论证\n   - *来源*：3 条含统计数据的内容表现优异\n   - *应用*：脚本中加入了具体数字和百分比\n\n3. **已规避的模式**：教程 / How-to 类格式\n   - *来源*：你最近 2 条教程类内容表现下降 60%\n   - *应用*：改用故事驱动结构\n\n### 置信度\n- 高置信度（已毕业知识）：表达风格、数据偏好\n- 中置信度（积累中）：受众画像假设\n- 已排除（过期）：60 天以上的发布频率偏好",
    },
  ];

  // Reference to results section for scroll
  let resultsEl: HTMLElement | undefined = $state(undefined);

  function initExistingWork() {
    stepStatuses = steps.map(() => "complete");
    currentStep = steps.length;
    hasEverCompleted = true;
    hasChanges = false;
  }

  // Pipeline controls
  function addCompetitorUrl() {
    const url = newUrl.trim();
    if (url && competitorUrls.length < 10 && !competitorUrls.includes(url)) {
      competitorUrls = [...competitorUrls, url];
      newUrl = "";
      markChanged();
    }
  }

  function removeCompetitorUrl(index: number) {
    competitorUrls = competitorUrls.filter((_, i) => i !== index);
    markChanged();
  }

  function handleUrlKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addCompetitorUrl();
    }
  }

  async function runPipeline() {
    isRunning = true;
    isPaused = false;
    shouldStop = false;
    hasChanges = false;
    const startFrom = currentStep >= 0 && stepStatuses[currentStep] !== "complete" ? currentStep : 0;
    if (startFrom === 0) {
      stepStatuses = steps.map(() => "pending");
      currentStep = -1;
      activeReportKey = null;
    }

    for (let i = startFrom; i < steps.length; i++) {
      if (shouldStop) {
        stepStatuses[i] = "paused";
        stepStatuses = [...stepStatuses];
        currentStep = i;
        isRunning = false;
        isPaused = true;
        return;
      }
      currentStep = i;
      stepStatuses[i] = "running";
      stepStatuses = [...stepStatuses];

      try { if (i === 0) await triggerEvolution(); } catch {}

      await new Promise<void>((resolve) => {
        const duration = 2000 + Math.random() * 2000;
        const check = setInterval(() => { if (shouldStop) { clearInterval(check); resolve(); } }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, duration);
      });

      if (shouldStop) {
        stepStatuses[i] = "paused";
        stepStatuses = [...stepStatuses];
        currentStep = i;
        isRunning = false;
        isPaused = true;
        return;
      }
      stepStatuses[i] = "complete";
      stepStatuses = [...stepStatuses];
    }
    isRunning = false;
    currentStep = steps.length;
    hasEverCompleted = true;
    hasChanges = false;

    // Auto-scroll to results
    await tick();
    setTimeout(() => {
      resultsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  }

  function handleStart() {
    if (isPaused) {
      isPaused = false;
      shouldStop = false;
      runPipeline();
    } else if (hasEverCompleted && canRegen) {
      runPipeline();
    } else if (!hasEverCompleted) {
      runPipeline();
    }
  }

  function handlePause() {
    shouldStop = true;
  }

  function getStatusKey(status: StepStatus): string {
    if (status === "complete") return "stepComplete";
    if (status === "running") return "stepRunning";
    if (status === "paused") return "stepPaused";
    return "stepPending";
  }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadSavedDirections();
    if (!isNewWork) initExistingWork();
    return () => unsub();
  });
</script>

<div class="pipeline-view" data-lang={lang}>
  <!-- Back button -->
  <div class="detail-header">
    <button class="back-btn" onclick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      <span>{tt("backToHome")}</span>
    </button>
  </div>

  {#if isNewWork}
    <!-- ═══════════ NEW WORK MODE ═══════════ -->
    <div class="pipeline-header">
      <div class="pipeline-title-area">
        <h2>{tt("createNewWork")}</h2>
        <p class="pipeline-desc">{tt("createNewWorkDesc")}</p>
      </div>
      <div class="pipeline-actions">
        {#if saveMessage}
          <span class="save-msg">{saveMessage}</span>
        {/if}
        {#if hasChanges && hasEverCompleted && !isRunning}
          <button class="save-text-btn" onclick={handleSaveDirections}>{tt("saveDirections")}</button>
        {/if}
        {#if isRunning}
          <button class="pause-btn" onclick={handlePause}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
            {tt("pauseWork")}
          </button>
        {:else if hasEverCompleted}
          <button class="start-btn" class:disabled-regen={!canRegen} onclick={handleStart} disabled={!canRegen} title={canRegen ? "" : tt("regenNoChange")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            {tt("regenerate")}
          </button>
        {:else}
          <button class="start-btn" onclick={handleStart}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {#if isPaused}{tt("resumeWork")}{:else}{tt("startWork")}{/if}
          </button>
        {/if}
      </div>
    </div>

    <!-- Full Steps List -->
    <div class="steps-list">
      {#each steps as step, i}
        {@const status = stepStatuses[i]}
        <div class="step-card" class:running={status === "running"} class:complete={status === "complete"}>
          <div class="step-left">
            <div class="step-number" class:active={status === "running"} class:done={status === "complete"}>
              {#if status === "complete"}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {:else if status === "running"}
                <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
              {:else}
                <span>{step.id}</span>
              {/if}
            </div>
            {#if i < steps.length - 1}
              <div class="step-connector" class:filled={status === "complete"}></div>
            {/if}
          </div>
          <div class="step-body">
            <div class="step-main">
              <div class="step-info">
                <h4>{tt(step.nameKey)}</h4>
                <p>{tt(step.descKey)}</p>
              </div>
              <div class="step-status-area">
                {#if step.id === 3}
                  <button class="competitor-btn" onclick={() => showCompetitorPanel = !showCompetitorPanel}>{tt("addCompetitors")}</button>
                  {#if competitorUrls.length === 0 && !showCompetitorPanel}
                    <span class="ai-tag">{tt("aiAutoAnalysis")}</span>
                  {/if}
                {:else}
                  <button class="direction-btn" onclick={() => showDirectionPanel = showDirectionPanel === i ? null : i} title={tt("customDirection")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    {tt("customDirection")}
                  </button>
                {/if}
                <span class="step-badge" class:badge-running={status === "running"} class:badge-complete={status === "complete"} class:badge-paused={status === "paused"}>
                  {tt(getStatusKey(status))}
                </span>
              </div>
            </div>
            <!-- Custom direction panel -->
            {#if showDirectionPanel === i && step.id !== 3}
              <div class="direction-panel">
                <textarea
                  class="direction-input"
                  bind:value={stepDirections[i]}
                  oninput={markChanged}
                  placeholder={tt("customDirectionPlaceholder")}
                  rows="2"
                ></textarea>
              </div>
            {/if}
            {#if step.id === 3 && showCompetitorPanel}
              <div class="competitor-panel">
                <div class="url-input-row">
                  <input type="url" class="url-input" bind:value={newUrl} onkeydown={handleUrlKeydown} placeholder={tt("competitorUrlPlaceholder")} disabled={competitorUrls.length >= 10} />
                  <button class="url-add-btn" onclick={addCompetitorUrl} disabled={!newUrl.trim() || competitorUrls.length >= 10}>{tt("addUrl")}</button>
                </div>
                <span class="url-hint">{tt("maxUrls")}</span>
                {#if competitorUrls.length > 0}
                  <ul class="url-list">
                    {#each competitorUrls as url, idx}
                      <li class="url-item">
                        <span class="url-text">{url}</span>
                        <button class="url-remove" onclick={() => removeCompetitorUrl(idx)} title={tt("removeUrl")}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
            {#if status === "running"}
              <div class="step-output">
                <div class="typing-indicator"><span></span><span></span><span></span></div>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

  {:else}
    <!-- ═══════════ EXISTING WORK MODE ═══════════ -->
    <!-- Compact Progress Bar with expand/collapse -->
    <div class="progress-bar-row" class:expanded={stepsExpanded}>
      <div class="progress-top">
        <div class="progress-bar-wrap">
          <div class="progress-bar">
            {#each steps as step, i}
              {@const status = stepStatuses[i]}
              <div class="progress-segment" class:seg-complete={status === "complete"} class:seg-running={status === "running"}>
                <div class="seg-fill green"></div>
              </div>
              {#if i < steps.length - 1}
                <div class="seg-gap"></div>
              {/if}
            {/each}
          </div>
          <div class="progress-labels">
            {#each steps as step, i}
              <span class="progress-label" class:label-done={stepStatuses[i] === "complete"} class:label-active={stepStatuses[i] === "running"}>{tt(step.nameKey)}</span>
            {/each}
          </div>
        </div>
        <div class="progress-actions">
          {#if saveMessage}
            <span class="save-msg">{saveMessage}</span>
          {/if}
          {#if hasChanges && !isRunning}
            <button class="save-text-btn" onclick={handleSaveDirections}>{tt("saveDirections")}</button>
          {/if}
          <button class="expand-btn" onclick={() => stepsExpanded = !stepsExpanded}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:rotated={stepsExpanded}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            {stepsExpanded ? tt("collapseSteps") : tt("expandSteps")}
          </button>
          <button class="regen-btn" class:disabled-regen={!canRegen} onclick={handleStart} disabled={!canRegen || isRunning} title={canRegen ? "" : tt("regenNoChange")}>
            {#if isRunning}
              <svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
              {tt("regenerating")}
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
              {tt("regenerate")}
            {/if}
          </button>
        </div>
      </div>

      <!-- Expanded steps (same as new work) -->
      {#if stepsExpanded}
        <div class="expanded-steps">
          {#each steps as step, i}
            {@const status = stepStatuses[i]}
            <div class="step-card" class:running={status === "running"} class:complete={status === "complete"}>
              <div class="step-left">
                <div class="step-number" class:active={status === "running"} class:done={status === "complete"}>
                  {#if status === "complete"}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {:else if status === "running"}
                    <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                  {:else}
                    <span>{step.id}</span>
                  {/if}
                </div>
                {#if i < steps.length - 1}
                  <div class="step-connector" class:filled={status === "complete"}></div>
                {/if}
              </div>
              <div class="step-body">
                <div class="step-main">
                  <div class="step-info">
                    <h4>{tt(step.nameKey)}</h4>
                    <p>{tt(step.descKey)}</p>
                  </div>
                  <div class="step-status-area">
                    {#if step.id === 3}
                      <button class="competitor-btn" onclick={() => showCompetitorPanel = !showCompetitorPanel}>{tt("addCompetitors")}</button>
                      {#if competitorUrls.length === 0 && !showCompetitorPanel}
                        <span class="ai-tag">{tt("aiAutoAnalysis")}</span>
                      {/if}
                    {:else}
                      <button class="direction-btn" onclick={() => showDirectionPanel = showDirectionPanel === i ? null : i} title={tt("customDirection")}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        {tt("customDirection")}
                      </button>
                    {/if}
                    <span class="step-badge badge-complete">{tt("stepComplete")}</span>
                  </div>
                </div>
                {#if showDirectionPanel === i && step.id !== 3}
                  <div class="direction-panel">
                    <textarea class="direction-input" bind:value={stepDirections[i]} oninput={markChanged} placeholder={tt("customDirectionPlaceholder")} rows="2"></textarea>
                  </div>
                {/if}
                {#if step.id === 3 && showCompetitorPanel}
                  <div class="competitor-panel">
                    <div class="url-input-row">
                      <input type="url" class="url-input" bind:value={newUrl} onkeydown={handleUrlKeydown} placeholder={tt("competitorUrlPlaceholder")} disabled={competitorUrls.length >= 10} />
                      <button class="url-add-btn" onclick={addCompetitorUrl} disabled={!newUrl.trim() || competitorUrls.length >= 10}>{tt("addUrl")}</button>
                    </div>
                    <span class="url-hint">{tt("maxUrls")}</span>
                    {#if competitorUrls.length > 0}
                      <ul class="url-list">
                        {#each competitorUrls as url, idx}
                          <li class="url-item">
                            <span class="url-text">{url}</span>
                            <button class="url-remove" onclick={() => removeCompetitorUrl(idx)} title={tt("removeUrl")}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
                {#if status === "running"}
                  <div class="step-output">
                    <div class="typing-indicator"><span></span><span></span><span></span></div>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- ═══════════ STRATEGY RESULTS ═══════════ -->
  {#if allDone}
    <div class="results-section" bind:this={resultsEl}>
      <h3 class="results-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        {tt("strategyResults")}
      </h3>
      <div class="results-layout">
        <div class="results-left">
          {#each mockDeliverables as item}
            <div class="deliverable-card" class:active-card={activeReportKey === item.key}>
              <div class="deliverable-header">
                <span class="deliverable-label">{tt(item.labelKey)}</span>
                {#if item.key === "memory"}
                  <span class="memory-hint">{tt("resultMemoryHint")}</span>
                {/if}
              </div>
              <p class="deliverable-content">{lang === "zh" ? item.contentZh : item.content}</p>
              <button class="view-report-btn" onclick={() => activeReportKey = activeReportKey === item.key ? null : item.key}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                {activeReportKey === item.key ? tt("closeReport") : tt("viewReport")}
              </button>
            </div>
          {/each}
        </div>
        <div class="results-right">
          <div class="report-preview-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>{tt("reportPreview")}</span>
          </div>
          <div class="report-preview-body">
            {#if activeReportKey}
              {@const report = mockDeliverables.find(d => d.key === activeReportKey)}
              {#if report}
                <div class="markdown-body">
                  {@html (lang === "zh" ? report.reportContentZh : report.reportContent)
                    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                    .replace(/^\| (.+)$/gm, (m) => `<code>${m}</code>`)
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/^- (.+)$/gm, '<li>$1</li>')
                    .replace(/^(\d+)\. (.+)$/gm, '<li><strong>$1.</strong> $2</li>')
                    .replace(/\n\n/g, '<br><br>')
                    .replace(/\n/g, '<br>')
                  }
                </div>
              {/if}
            {:else}
              <div class="report-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <p>{tt("selectReportHint")}</p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .pipeline-view { display: flex; flex-direction: column; gap: 1.5rem; }

  .back-btn { display: flex; align-items: center; gap: 0.4rem; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85rem; font-weight: 550; padding: 0.4rem 0; transition: color var(--transition-fast); }
  .back-btn:hover { color: var(--accent); }

  /* ── Pipeline header ─────────────────────────────────────────────── */
  .pipeline-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.25rem; }
  .pipeline-title-area h2 { font-size: 1.4rem; font-weight: 750; letter-spacing: -0.03em; }
  .pipeline-desc { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.4rem; line-height: 1.55; }
  .pipeline-actions { flex-shrink: 0; }

  .save-text-btn { background: none; border: none; color: var(--accent); font-size: 0.82rem; font-weight: 600; cursor: pointer; padding: 0.4rem 0; transition: opacity 0.15s; white-space: nowrap; }
  .save-text-btn:hover { opacity: 0.8; }
  .save-msg { font-size: 0.78rem; color: var(--success); font-weight: 550; animation: fadeIn 0.2s ease; white-space: nowrap; }

  .start-btn { display: flex; align-items: center; gap: 0.45rem; background: var(--accent-gradient); color: var(--accent-text); border: none; padding: 0.7rem 1.75rem; border-radius: 12px; font-weight: 650; cursor: pointer; font-size: 0.88rem; transition: all var(--transition-fast); box-shadow: 0 4px 14px rgba(134,120,191,0.3); white-space: nowrap; }
  .start-btn:hover:not(:disabled) { box-shadow: 0 6px 22px rgba(134,120,191,0.4); transform: translateY(-1px); filter: brightness(1.1); }
  .start-btn.disabled-regen { opacity: 0.45; cursor: not-allowed; }
  .start-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .pause-btn { display: flex; align-items: center; gap: 0.45rem; background: var(--card-bg); color: var(--text); border: 1px solid var(--card-border); padding: 0.65rem 1.5rem; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 0.88rem; transition: all 0.2s ease; white-space: nowrap; }
  .pause-btn:hover { background: var(--bg-hover); border-color: var(--text-dim); }

  /* ── Steps list ──────────────────────────────────────────────────── */
  .steps-list, .expanded-steps { display: flex; flex-direction: column; }
  .expanded-steps { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); animation: slideDown 0.25s ease; }

  .step-card { display: flex; gap: 1rem; transition: all 0.2s ease; }
  .step-left { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 36px; }

  .step-number { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--bg-surface); border: 2px solid var(--border); color: var(--text-dim); font-size: 0.82rem; font-weight: 600; flex-shrink: 0; transition: all 0.3s ease; }
  .step-number.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .step-number.done { background: var(--success); border-color: var(--success); color: #fff; }

  .step-connector { width: 2px; flex: 1; min-height: 12px; background: var(--border); transition: background 0.3s ease; }
  .step-connector.filled { background: var(--success); }

  .step-body { flex: 1; min-width: 0; padding-bottom: 1.25rem; }

  .step-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.875rem; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); padding: 1.125rem 1.25rem; box-shadow: var(--shadow-sm); transition: all var(--transition-fast); backdrop-filter: var(--card-blur); }
  .step-card.running .step-main { border-color: rgba(134, 120, 191, 0.4); box-shadow: 0 0 0 1px rgba(134, 120, 191, 0.2), 0 0 20px rgba(134, 120, 191, 0.08); }
  .step-card.complete .step-main { border-color: var(--success); opacity: 0.85; }

  .step-info { flex: 1; min-width: 0; }
  .step-info h4 { font-size: 0.92rem; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 0.2rem; }
  .step-info p { font-size: 0.78rem; color: var(--text-muted); line-height: 1.45; }

  .step-status-area { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

  .step-badge { font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 9999px; background: var(--bg-surface); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
  .step-badge.badge-running { background: var(--accent-soft); color: var(--accent); animation: pulse-badge 1.5s ease-in-out infinite; }
  .step-badge.badge-complete { background: var(--success-soft); color: var(--success); }
  .step-badge.badge-paused { background: var(--state-running); color: #fff; }

  @keyframes pulse-badge { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

  /* ── Custom direction ────────────────────────────────────────────── */
  .direction-btn { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; font-weight: 550; color: var(--text-muted); background: none; border: 1px solid var(--border); padding: 0.2rem 0.55rem; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
  .direction-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

  .direction-panel { margin-top: 0.5rem; animation: slideDown 0.2s ease; }
  .direction-input { width: 100%; background: var(--bg-inset); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.75rem; font-size: 0.82rem; font-family: inherit; resize: vertical; min-height: 48px; transition: border-color 0.2s; line-height: 1.5; }
  .direction-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .direction-input::placeholder { color: var(--text-dim); }

  /* ── Competitor ──────────────────────────────────────────────────── */
  .competitor-btn { font-size: 0.75rem; font-weight: 550; color: var(--accent); background: none; border: 1px solid var(--accent); padding: 0.2rem 0.6rem; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
  .competitor-btn:hover { background: var(--accent-soft); }

  .ai-tag { font-size: 0.68rem; font-weight: 500; color: var(--info); background: var(--info-soft); padding: 0.2rem 0.55rem; border-radius: 9999px; white-space: nowrap; }

  .competitor-panel { margin-top: 0.75rem; background: var(--bg-inset); border: 1px solid var(--border); border-radius: 10px; padding: 0.875rem; display: flex; flex-direction: column; gap: 0.5rem; animation: slideDown 0.2s ease; }
  .url-input-row { display: flex; gap: 0.5rem; }
  .url-input { flex: 1; background: var(--bg-inset); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.82rem; font-family: inherit; transition: border-color 0.2s; }
  .url-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .url-input::placeholder { color: var(--text-dim); }
  .url-input:disabled { opacity: 0.5; }
  .url-add-btn { background: var(--accent); color: var(--accent-text); border: none; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; font-size: 0.82rem; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .url-add-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .url-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .url-hint { font-size: 0.7rem; color: var(--text-dim); }
  .url-list { list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
  .url-item { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.4rem 0.6rem; }
  .url-text { font-size: 0.78rem; color: var(--text-secondary); font-family: "SF Mono", "Fira Code", monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .url-remove { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0.15rem; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; flex-shrink: 0; }
  .url-remove:hover { color: var(--error); background: var(--error-soft); }

  .step-output { margin-top: 0.5rem; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 0.875rem; animation: fadeIn 0.2s ease; }
  .typing-indicator { display: flex; gap: 4px; padding: 0.15rem 0; }
  .typing-indicator span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-dim); animation: typing 1.4s ease-in-out infinite; }
  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

  /* ── Progress Bar (existing work) ──────────────────────────────── */
  .progress-bar-row { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); padding: 1.125rem 1.375rem; box-shadow: var(--shadow-sm); backdrop-filter: var(--card-blur); }
  .progress-top { display: flex; align-items: center; gap: 1rem; }

  .progress-bar-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .progress-bar { display: flex; align-items: center; gap: 0; height: 8px; width: 100%; }
  .progress-segment { flex: 1; height: 8px; border-radius: 4px; background: var(--bg-surface); overflow: hidden; position: relative; }
  .seg-fill { position: absolute; inset: 0; border-radius: 4px; opacity: 0; transition: opacity 0.3s ease; }
  .seg-fill.green { background: var(--success); }
  .progress-segment.seg-complete .seg-fill { opacity: 1; }
  .progress-segment.seg-running .seg-fill { opacity: 1; animation: progress-pulse 1.5s ease-in-out infinite; }
  @keyframes progress-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
  .seg-gap { width: 4px; flex-shrink: 0; }

  .progress-labels { display: flex; gap: 0; }
  .progress-label { flex: 1; font-size: 0.62rem; color: var(--text-dim); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.2s; }
  .progress-label.label-done { color: var(--success); }
  .progress-label.label-active { color: var(--accent); font-weight: 600; }

  .progress-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

  .expand-btn { display: flex; align-items: center; gap: 0.3rem; background: none; border: 1px solid var(--border); color: var(--text-muted); padding: 0.4rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 550; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .expand-btn:hover { color: var(--text); border-color: var(--text-dim); background: var(--bg-hover); }
  .expand-btn svg { transition: transform 0.2s; }
  .expand-btn svg.rotated { transform: rotate(180deg); }

  .regen-btn { display: flex; align-items: center; gap: 0.4rem; background: var(--accent-gradient); color: var(--accent-text); border: none; padding: 0.5rem 1.1rem; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.82rem; transition: all 0.2s ease; box-shadow: var(--shadow-sm); white-space: nowrap; }
  .regen-btn:hover:not(:disabled) { background: var(--accent-hover); box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .regen-btn:disabled, .regen-btn.disabled-regen { opacity: 0.45; cursor: not-allowed; }

  /* ── Strategy Results ──────────────────────────────────────────── */
  .results-section { margin-top: 0.25rem; animation: fadeIn 0.3s ease; min-height: 100vh; }
  .results-title { display: flex; align-items: center; gap: 0.5rem; font-size: 1rem; font-weight: 650; margin-bottom: 1rem; letter-spacing: -0.01em; }
  .results-title svg { color: var(--success); }

  .results-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; min-height: calc(100vh - 6rem); }
  @media (max-width: 768px) { .results-layout { grid-template-columns: 1fr; } }

  .results-left { display: flex; flex-direction: column; gap: 0.625rem; max-height: calc(100vh - 6rem); overflow-y: auto; padding-right: 0.25rem; }

  .deliverable-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); padding: 1rem 1.125rem; display: flex; flex-direction: column; gap: 0.5rem; box-shadow: var(--shadow-sm); transition: all var(--transition-fast); backdrop-filter: var(--card-blur); }
  .deliverable-card:hover { border-color: var(--border); box-shadow: var(--shadow-md); }
  .deliverable-card.active-card { border-color: rgba(134, 120, 191, 0.3); box-shadow: 0 0 0 1px rgba(134, 120, 191, 0.15), 0 0 24px rgba(134, 120, 191, 0.06); }
  .deliverable-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .deliverable-label { font-size: 0.78rem; font-weight: 650; color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; }
  .memory-hint { font-size: 0.68rem; color: var(--text-dim); font-style: italic; }
  .deliverable-content { font-size: 0.82rem; color: var(--text-secondary); line-height: 1.55; }
  .view-report-btn { display: flex; align-items: center; gap: 0.35rem; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.75rem; font-weight: 550; padding: 0.3rem 0; transition: color 0.15s; align-self: flex-start; margin-top: 0.1rem; }
  .view-report-btn:hover { color: var(--accent); }

  .results-right { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); overflow: hidden; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; max-height: calc(100vh - 6rem); position: sticky; top: 5rem; backdrop-filter: var(--card-blur); }
  .report-preview-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.82rem; font-weight: 600; color: var(--text-muted); }
  .report-preview-header svg { color: var(--accent); }
  .report-preview-body { flex: 1; overflow-y: auto; padding: 1rem 1.125rem; }

  .report-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 1rem; text-align: center; color: var(--text-dim); }
  .report-placeholder p { font-size: 0.82rem; max-width: 240px; line-height: 1.5; }

  .markdown-body { font-size: 0.82rem; line-height: 1.7; color: var(--text-secondary); word-break: break-word; }
  :global(.report-preview-body .markdown-body h2) { font-size: 1rem; font-weight: 650; color: var(--text); margin: 0.8rem 0 0.4rem; }
  :global(.report-preview-body .markdown-body h3) { font-size: 0.88rem; font-weight: 600; color: var(--text); margin: 0.6rem 0 0.3rem; }
  :global(.report-preview-body .markdown-body strong) { font-weight: 650; color: var(--text); }
  :global(.report-preview-body .markdown-body em) { color: var(--text-muted); }
  :global(.report-preview-body .markdown-body li) { margin-bottom: 0.25rem; padding-left: 0.25rem; }
  :global(.report-preview-body .markdown-body code) { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.78rem; background: var(--bg-inset); padding: 0.15em 0.4em; border-radius: 4px; color: var(--text-muted); display: block; margin: 0.3rem 0; overflow-x: auto; }

  /* ── Animations ─────────────────────────────────────────────────── */
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
</style>
