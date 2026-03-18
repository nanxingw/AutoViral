type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation
    explore: "Explore",
    works: "Works",
    analytics: "Analytics",
    settings: "Settings",
    newWork: "New Work",

    // Config
    researchConfig: "Research Configuration",
    researchInterval: "Research Interval",
    aiModel: "AI Model",
    autoResearch: "Auto Research",
    startResearch: "Start Research",
    researchingDots: "Researching...",
    researchStarted: "Research started successfully!",
    researchFailed: "Failed to start research.",
    claudeHaikuFast: "Claude Haiku (Fast)",
    claudeSonnetBalanced: "Claude Sonnet (Balanced)",
    claudeOpusCapable: "Claude Opus (Most Capable)",
    minutes15: "Every 15 minutes",
    minutes30: "Every 30 minutes",
    hour1: "Every 1 hour",
    hours2: "Every 2 hours",
    hours4: "Every 4 hours",
    hours8: "Every 8 hours",

    // Common
    saveChanges: "Save Changes",
    saving: "Saving...",
    settingsSaved: "Settings saved successfully.",
    settingsSaveFailed: "Failed to save settings.",
    loading: "Loading...",
    cancel: "Cancel",
    create: "Create",
    send: "Send",

    // Works page
    myWorks: "My Works",
    noWorks: "No works yet. Create your first one!",
    createFirstWork: "Create your first work",
    filterAll: "All",
    filterCreating: "Creating",
    filterReady: "Ready",
    shortVideo: "Short Video",
    imageText: "Image & Text",

    // Work status
    workDraft: "Draft",
    workCreating: "Creating",
    workReady: "Ready",
    workFailed: "Failed",

    // NewWorkModal
    newWorkBtn: "New Work",
    selectType: "Content Type",
    selectPlatforms: "Platforms",
    topicHint: "Topic Hint",
    topicHintPlaceholder: "Enter direction you want to create (optional)",
    titlePlaceholder: "Optional — AI will generate if empty",
    resultTitle: "Title",

    // Platforms
    xiaohongshu: "Xiaohongshu",
    douyin: "Douyin",

    // Studio & Chat
    studio: "Studio",
    chatPlaceholder: "Type your feedback...",
    chatWithAgent: "Chat with Agent",
    sessionConnecting: "Connecting...",
    sessionReady: "Agent Ready",
    nextStep: "Next Step",
    redoStep: "Redo Step",
    publish: "Publish",
    pipelineSteps: "Pipeline Steps",
    backToHome: "Back",

    // Pipeline step statuses
    stepPendingLabel: "Pending",
    stepRunningLabel: "Running...",
    stepCompletedLabel: "Completed",
    stepFailedLabel: "Failed",

    // 4 pipeline steps
    stepResearch: "Research",
    stepPlan: "Plan",
    stepAssets: "Assets",
    stepAssembly: "Assembly",

    // Explore page
    ytTrending: "YouTube Trending",
    ttTrending: "TikTok Trending",
    ytTags: "YouTube Hot Topics",
    ttTags: "TikTok Hot Topics",
    views: "views",
    likes: "likes",
    comments: "comments",
    posts: "posts",

    // Analytics page
    followers: "Followers",
    todayLikes: "Today Likes",
    todayComments: "Today Comments",
    styleKeywords: "Style Profile",
    fanDemographics: "Fan Demographics",
    ageDistribution: "Age Distribution",
    genderSplit: "Gender Split",
    topRegions: "Top Regions",
    latestInsights: "Latest Research Insights",
    male: "Male",
    female: "Female",

    // Memory
    memory: "Memory",
    styleProfile: "Style Profile",
    learnedRules: "Learned Rules",
    memorySearch: "Search memory",
    tabMemory: "Memory",

    // Assets
    assets: "Assets",
    output: "Output",
    downloadAll: "Download All",
    noAssetsYet: "No assets yet",

    // Settings panel
    settingsTitle: "Settings",
    languageSetting: "Language",
    themeSetting: "Theme",
    darkTheme: "Dark",
    lightTheme: "Light",

    // Misc
    confirmDelete: "Confirm delete?",
  },
  zh: {
    // Navigation
    explore: "探索",
    works: "作品",
    analytics: "数据",
    settings: "设置",
    newWork: "新建作品",

    // Config
    researchConfig: "调研配置",
    researchInterval: "调研频率",
    aiModel: "AI 模型",
    autoResearch: "自动调研",
    startResearch: "开始调研",
    researchingDots: "调研中...",
    researchStarted: "调研已成功启动！",
    researchFailed: "启动调研失败。",
    claudeHaikuFast: "Claude Haiku（快速）",
    claudeSonnetBalanced: "Claude Sonnet（平衡）",
    claudeOpusCapable: "Claude Opus（最强大）",
    minutes15: "每 15 分钟",
    minutes30: "每 30 分钟",
    hour1: "每 1 小时",
    hours2: "每 2 小时",
    hours4: "每 4 小时",
    hours8: "每 8 小时",

    // Common
    saveChanges: "保存更改",
    saving: "保存中...",
    settingsSaved: "设置保存成功。",
    settingsSaveFailed: "保存设置失败。",
    loading: "加载中...",
    cancel: "取消",
    create: "创建",
    send: "发送",

    // Works page
    myWorks: "我的作品",
    noWorks: "还没有作品，创建第一个吧！",
    createFirstWork: "创建你的第一个作品",
    filterAll: "全部",
    filterCreating: "创建中",
    filterReady: "已完成",
    shortVideo: "短视频",
    imageText: "图文",

    // Work status
    workDraft: "草稿",
    workCreating: "创作中",
    workReady: "待发布",
    workFailed: "失败",

    // NewWorkModal
    newWorkBtn: "新建作品",
    selectType: "内容类型",
    selectPlatforms: "发布平台",
    topicHint: "选题提示",
    topicHintPlaceholder: "输入你想创建的方向（可选）",
    titlePlaceholder: "可选，不填则AI自动生成",
    resultTitle: "标题",

    // Platforms
    xiaohongshu: "小红书",
    douyin: "抖音",

    // Studio & Chat
    studio: "创作工坊",
    chatPlaceholder: "输入反馈...",
    chatWithAgent: "与Agent对话",
    sessionConnecting: "连接中...",
    sessionReady: "Agent就绪",
    nextStep: "下一步",
    redoStep: "重做此步",
    publish: "发布",
    pipelineSteps: "流水线步骤",
    backToHome: "返回",

    // Pipeline step statuses
    stepPendingLabel: "待开始",
    stepRunningLabel: "生成中...",
    stepCompletedLabel: "已完成",
    stepFailedLabel: "失败",

    // 4 pipeline steps
    stepResearch: "调研",
    stepPlan: "策划",
    stepAssets: "素材",
    stepAssembly: "成片",

    // Explore page
    ytTrending: "抖音热门视频",
    ttTrending: "小红书热门视频",
    ytTags: "抖音热门话题",
    ttTags: "小红书热门话题",
    views: "播放",
    likes: "点赞",
    comments: "评论",
    posts: "内容",

    // Analytics page
    followers: "粉丝",
    todayLikes: "今日点赞",
    todayComments: "今日评论",
    styleKeywords: "风格画像",
    fanDemographics: "粉丝画像",
    ageDistribution: "年龄分布",
    genderSplit: "性别比例",
    topRegions: "地区分布",
    latestInsights: "最新调研洞察",
    male: "男",
    female: "女",

    // Memory
    memory: "记忆",
    styleProfile: "风格画像",
    learnedRules: "已学规则",
    memorySearch: "搜索记忆",
    tabMemory: "记忆",

    // Assets
    assets: "素材",
    output: "成品",
    downloadAll: "下载全部",
    noAssetsYet: "暂无素材",

    // Settings panel
    settingsTitle: "设置",
    languageSetting: "语言",
    themeSetting: "主题",
    darkTheme: "深色",
    lightTheme: "浅色",

    // Misc
    confirmDelete: "确认删除?",
  },
};

let currentLanguage: Language = "en";
let listeners: Set<() => void> = new Set();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language) {
  currentLanguage = lang;
  localStorage.setItem("autocode-lang", lang);
  listeners.forEach((fn) => fn());
}

export function t(key: string): string {
  return translations[currentLanguage][key] ?? key;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Initialize from localStorage
if (typeof localStorage !== "undefined") {
  const saved = localStorage.getItem("autocode-lang") as Language | null;
  if (saved === "en" || saved === "zh") {
    currentLanguage = saved;
  }
}
