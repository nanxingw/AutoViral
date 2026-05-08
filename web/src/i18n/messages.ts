/**
 * Mini i18n message catalog.
 *
 * Two locales: zh (default in browser) + en (default in tests so existing
 * `screen.getByText("Headline font")` patterns don't have to be rewritten
 * en masse). Both shapes MUST stay structurally identical — TypeScript
 * derives the legal `t()` keys from `Messages` so a missing zh entry will
 * show up as a type error.
 */

export const en = {
  common: {
    cancel: "Cancel",
    confirm: "Confirm",
    submit: "Submit",
    loading: "Loading…",
    saved: "Saved",
    unsaved: "Unsaved",
  },
  topnav: {
    works: "Works · 作品",
    explore: "Explore · 灵感",
    analytics: "Analytics · 数据",
    versionTag: "v3 · DESIGN",
    localeToggleZh: "中",
    localeToggleEn: "EN",
  },
  editor: {
    topbar: {
      backToWorks: "← Works",
      exportMenu: "Export ▾",
      exportCurrent: "Current slide as PNG",
      exportAll: "All slides as PNGs",
    },
    inspectorTabs: {
      design: "Design",
      copy: "Copy",
      ai: "AI",
    },
    designTab: {
      headlineFont: "Headline font",
      fontSerif: "Serif",
      fontSans: "Sans",
      fontMono: "Mono",
      palette: "Palette",
      layout: "Layout",
      layoutCentered: "Centered",
      layoutLeft: "Left",
      layoutSplit: "Split",
      effects: "Effects",
      effectGrain: "grain",
      effectGradient: "gradient",
      effectSharpen: "sharpen",
    },
    copyTab: {
      empty: "Select a text layer to edit its copy.",
      headline: "Headline",
      rewriteWithAI: "Rewrite with AI",
      busy: "...",
      emptyResponse: "Empty response from rewriter",
    },
    aiTab: {
      stylePrompt: "Style prompt",
      stylePlaceholder: "e.g. soft analog film, beige tones, hand-drawn type",
      quickStyles: "Quick styles",
      quick: {
        minimalEditorial: "minimal editorial",
        softPastel: "soft pastel",
        neonCyberpunk: "neon cyberpunk",
        earthyZine: "earthy zine",
        highContrastNoir: "high-contrast noir",
        sunBleachedFilm: "sun-bleached film",
      },
      regenerateAll: "Regenerate all {count} slides",
      msgQueued: "queued — watching for carousel update…",
      msgUpdated: "updated",
      msgQueuedTimeout: "queued (no update detected within 60s)",
    },
    filmstrip: {
      dragToReorder: "Drag to reorder",
      deleteSlide: "Delete slide {index}",
      duplicateSlide: "Duplicate slide {index}",
      addSlide: "Add slide",
    },
  },
  studio: {
    topBar: {
      back: "Back",
      versionTag: "Studio · v4.0",
      saved: "SAVED",
      unsaved: "UNSAVED",
      exportFull: "Export",
      moreExportOptions: "More export options",
      quickProxyExport: "Quick proxy export",
      toggleSettings: "Toggle settings",
    },
  },
  works: {
    filter: {
      all: "All",
      draft: "Draft",
      published: "Published",
      archived: "Archived",
    },
    type: {
      video: "VIDEO",
      image: "IMAGE",
    },
    status: {
      draft: "DRAFT",
      creating: "CREATING",
      ready: "READY",
      failed: "FAILED",
      published: "PUBLISHED",
      archived: "ARCHIVED",
    },
    searchPlaceholder: "Search works…",
    newWork: "Create work",
    emptySearch: "No works match {query}",
  },
  checkpoints: {
    button: "History",
    empty: "No snapshots yet — they appear after each agent turn.",
    restoreLabel: "Restore",
    restored: "Restored {deliverable}",
  },
  explore: {
    collectTrends: "Refresh trends now",
    collectInProgress: "Collecting…",
    collectQueued: "Collection queued — refresh in ~30s",
    collectFailed: "Collection failed: {reason}",
    anglesNote: "Static recommendations (algorithm not wired yet)",
  },
  analytics: {
    collectionNote: "Data is collected by a background job hourly. If empty for long, check Python deps (browser_cookie3) on the host.",
  },
  chat: {
    agentName: "Creative Agent",
    streaming: "STREAMING",
    msgCount: "MSG",
    loadingHistory: "LOADING HISTORY…",
    emptyPrompt: "· say hi to get started ·",
    onboardingTitle: "Pick a starting point",
    onboardingSub: "or just type below",
    onboardingPlanning: "💡 Outline the story",
    onboardingAssets: "🎨 Pick a visual direction",
    onboardingResearch: "🔍 Check what's trending",
    onboardingPlanningPrompt: "Help me turn this idea into a concrete outline:",
    onboardingAssetsPrompt: "Recommend 3 visual style directions for this work, briefly justify each.",
    onboardingResearchPrompt: "Use research module to summarise what's currently trending around this topic on XHS/Douyin.",
    thinking: "thinking…",
    composerPlaceholder: "ask anything…",
    sendHint: "⌘↵ SEND",
    quickActions: {
      editor: {
        rewriteHook: "Rewrite copy",
        regenImage: "Regenerate this image",
        swapPalette: "Swap palette",
      },
      studio: {
        regenClip: "Regenerate this clip",
        adjustRhythm: "Adjust rhythm",
        swapBgm: "Swap BGM",
      },
    },
  },
} as const;

export type Messages = typeof en;

/** Recursive deep-replace type so zh has the same nested shape as en. */
type DeepShape<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepShape<T[K]>;
};

export const zh: DeepShape<Messages> = {
  common: {
    cancel: "取消",
    confirm: "确认",
    submit: "确定",
    loading: "加载中…",
    saved: "已保存",
    unsaved: "未保存",
  },
  topnav: {
    works: "作品",
    explore: "灵感",
    analytics: "数据",
    versionTag: "v3 · 设计版",
    localeToggleZh: "中",
    localeToggleEn: "EN",
  },
  editor: {
    topbar: {
      backToWorks: "← 作品",
      exportMenu: "导出 ▾",
      exportCurrent: "当前页导出为 PNG",
      exportAll: "全部页面导出为 PNG",
    },
    inspectorTabs: {
      design: "设计",
      copy: "文案",
      ai: "AI",
    },
    designTab: {
      headlineFont: "标题字体",
      fontSerif: "衬线",
      fontSans: "无衬线",
      fontMono: "等宽",
      palette: "配色",
      layout: "版式",
      layoutCentered: "居中",
      layoutLeft: "靠左",
      layoutSplit: "分屏",
      effects: "效果",
      effectGrain: "颗粒",
      effectGradient: "渐变",
      effectSharpen: "锐化",
    },
    copyTab: {
      empty: "请先选中文本图层再编辑文案。",
      headline: "标题",
      rewriteWithAI: "AI 改写",
      busy: "…",
      emptyResponse: "改写结果为空",
    },
    aiTab: {
      stylePrompt: "风格描述",
      stylePlaceholder: "例如：柔和胶片、米色调、手绘字体",
      quickStyles: "快速风格",
      quick: {
        minimalEditorial: "极简编辑",
        softPastel: "柔和粉彩",
        neonCyberpunk: "霓虹赛博",
        earthyZine: "大地杂志",
        highContrastNoir: "高反差黑色",
        sunBleachedFilm: "晒褪色胶片",
      },
      regenerateAll: "重新生成全部 {count} 页",
      msgQueued: "已排队 · 正在等待画布更新…",
      msgUpdated: "已更新",
      msgQueuedTimeout: "已排队（60 秒内未检测到更新）",
    },
    filmstrip: {
      dragToReorder: "拖动可排序",
      deleteSlide: "删除第 {index} 页",
      duplicateSlide: "复制第 {index} 页",
      addSlide: "添加页面",
    },
  },
  studio: {
    topBar: {
      back: "返回",
      versionTag: "Studio · v4.0",
      saved: "已保存",
      unsaved: "未保存",
      exportFull: "导出",
      moreExportOptions: "更多导出选项",
      quickProxyExport: "快速代理导出",
      toggleSettings: "切换设置",
    },
  },
  works: {
    filter: {
      all: "全部",
      draft: "草稿",
      published: "已发布",
      archived: "已归档",
    },
    type: {
      video: "视频",
      image: "图文",
    },
    status: {
      draft: "草稿",
      creating: "生成中",
      ready: "就绪",
      failed: "失败",
      published: "已发布",
      archived: "已归档",
    },
    searchPlaceholder: "搜索作品…",
    newWork: "新建作品",
    emptySearch: "没有作品匹配 {query}",
  },
  checkpoints: {
    button: "历史",
    empty: "暂无快照——agent 每完成一次对话会自动保存一份。",
    restoreLabel: "恢复",
    restored: "已恢复 {deliverable}",
  },
  explore: {
    collectTrends: "立即采集 Trends",
    collectInProgress: "采集中…",
    collectQueued: "已触发采集，约 30 秒后自动刷新",
    collectFailed: "采集失败：{reason}",
    anglesNote: "当前为静态推荐（算法尚未接入）",
  },
  analytics: {
    collectionNote: "数据由后台任务每小时采集一次。若长期为空，请检查 host 上 Python 依赖（browser_cookie3）是否安装。",
  },
  chat: {
    agentName: "创作代理",
    streaming: "流式中",
    msgCount: "条",
    loadingHistory: "正在加载历史…",
    emptyPrompt: "· 跟它说一句话开始 ·",
    onboardingTitle: "挑一个起点",
    onboardingSub: "或者直接在下面输入",
    onboardingPlanning: "💡 梳理故事大纲",
    onboardingAssets: "🎨 挑视觉方向",
    onboardingResearch: "🔍 看看话题趋势",
    onboardingPlanningPrompt: "请帮我把下面这个创意梳理成可执行的大纲：",
    onboardingAssetsPrompt: "请基于当前作品推荐 3 个视觉风格方向，每个简单说明取舍。",
    onboardingResearchPrompt: "请用 research 能力查一下当前话题在小红书 / 抖音的最新趋势。",
    thinking: "思考中…",
    composerPlaceholder: "问点什么…",
    sendHint: "⌘↵ 发送",
    quickActions: {
      editor: {
        rewriteHook: "写一段引导文案",
        regenImage: "重生成此图",
        swapPalette: "换 palette",
      },
      studio: {
        regenClip: "重生成此片段",
        adjustRhythm: "调整节奏",
        swapBgm: "换 BGM 风格",
      },
    },
  },
};

export const MESSAGES = { en, zh } as const;
export type LocaleId = keyof typeof MESSAGES;
