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
  },
  chat: {
    agentName: "Creative Agent",
    streaming: "STREAMING",
    msgCount: "MSG",
    loadingHistory: "LOADING HISTORY…",
    emptyPrompt: "· say hi to get started ·",
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
  },
  chat: {
    agentName: "创作代理",
    streaming: "流式中",
    msgCount: "条",
    loadingHistory: "正在加载历史…",
    emptyPrompt: "· 跟它说一句话开始 ·",
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
