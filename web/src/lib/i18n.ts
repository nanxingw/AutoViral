type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation
    explore: "Inspiration",
    works: "Works",
    analytics: "Analytics",
    settings: "Settings",

    // Common
    saveChanges: "Save",
    saving: "Saving...",
    settingsSaved: "Saved.",
    settingsSaveFailed: "Failed to save.",
    loading: "Loading...",
    cancel: "Cancel",
    create: "Create",
    send: "Send",
    done: "Done",
    back: "Back",
    delete: "Delete",
    confirmDelete: "Confirm delete?",

    // Works page
    myWorks: "Works",
    workList: "Works",
    newWork: "New",
    abortTask: "Abort",
    resumeTask: "Resume",
    abortedMessage: "Generation aborted.",
    pipelineSteps: "Steps",
    noWorks: "No works yet",
    noDrafts: "No drafts",
    noDraftsDesc: "All your works have been published",
    noPublished: "No published works",
    noPublishedDesc: "Finish creating a work and publish it",
    createFirstWork: "Create your first work",
    filterAll: "All",
    filterDraft: "Drafts",
    filterPublished: "Published",
    shortVideo: "Short Video",
    imageText: "Image & Text",

    // Work status
    workDraft: "Draft",
    workCreating: "Draft",
    workReady: "Published",
    workFailed: "Failed",
    monitoring: "Monitoring",

    // Insight banner
    autoResearchLabel: "Auto Research",
    insightBannerWithData: "While you were away, I researched {competitors} competitors and found ",
    inspirationTitle: "Viral Ideas",
    insightBannerEmpty: "Turn on Auto Research to discover viral ideas while you're away.",
    viralIdeas: " viral ideas",
    viralIdeasSuffix: ".",

    // NewWorkModal
    newWorkTitle: "New Work",
    selectType: "Format",
    videoSource: "Video Source",
    videoSourceUpload: "Upload",
    videoSourceSearch: "Web Search",
    videoSourceAI: "AI Generate",
    videoSourceUploadHint: "Upload your own video clips",
    videoSourceSearchHint: "AI searches and downloads matching videos",
    videoSourceAIHint: "Generate video clips with Jimeng AI",
    videoSearchPlaceholder: "Describe the video you're looking for...",
    contentCategory: "Category",
    categoryInfo: "Knowledge",
    categoryBeauty: "Aesthetic",
    categoryComedy: "Comedy",
    categoryInfoDesc: "Tutorials, tips, how-to",
    categoryBeautyDesc: "Visual, dance, fashion",
    categoryComedyDesc: "Skits, absurdist humor",
    resultTitle: "Title",
    titlePlaceholder: "Optional — AI generates if empty",
    topicHint: "Direction",
    topicHintPlaceholder: "What do you want to create? (optional)",

    // Platforms
    xiaohongshu: "Xiaohongshu",
    douyin: "Douyin",

    // Studio
    studio: "Studio",
    chatPlaceholder: "How would you like to modify the plan?",
    emptyChat: "Start a conversation",
    sessionConnecting: "Connecting...",
    sessionReady: "Ready",
    sessionCompleted: "Completed",
    nextStep: "Next Step",
    redoStep: "Redo",
    publish: "Publish",
    backToHome: "Back",
    chatMode: "Chat",
    canvasMode: "Canvas",

    // Pipeline steps
    stepPendingLabel: "Pending",
    stepRunningLabel: "Running...",
    stepCompletedLabel: "Done",
    stepFailedLabel: "Failed",
    stepMaterialSearch: "Search",
    stepResearch: "Research",
    stepPlan: "Plan",
    stepAssets: "Assets",
    stepAssembly: "Assemble",

    // Tool display names
    toolSearching: "Searching...",
    toolFetching: "Fetching page...",
    toolRunning: "Running command...",
    toolReading: "Reading file...",
    toolWriting: "Writing file...",
    toolEditing: "Editing file...",
    toolGrepping: "Searching code...",
    toolGlobbing: "Finding files...",
    toolDefault: "Running {name}...",

    // Research progress
    researchDone: "Research complete",

    // Explore / Inspiration page
    startResearch: "Research",
    cancelResearch: "Cancel",
    loadingTrends: "Loading trends...",
    emptyTrendsTitle: "No trends yet",
    emptyTrendsDesc: "Click \"New Ideas\" and wait a moment",
    viralHook: "Hook",
    createFromTrend: "Create from this",

    // Explore — platform tabs
    douyinTab: "Douyin",
    xiaohongshuTab: "Xiaohongshu",
    douyinTrending: "Douyin Trending",
    xiaohongshuTrending: "Xiaohongshu Trending",

    // Interest tags
    following: "Following",

    // Config
    researchConfig: "Research Config",
    researchInterval: "Interval",
    aiModel: "AI Model",
    autoResearch: "Auto Research",
    claudeHaikuFast: "Haiku (Fast)",
    claudeSonnetBalanced: "Sonnet (Balanced)",
    claudeOpusCapable: "Opus (Capable)",
    minutes15: "15 min",
    minutes30: "30 min",
    hour1: "1 hour",
    hours2: "2 hours",
    hours4: "4 hours",
    hours8: "8 hours",

    // Analytics
    followers: "Followers",
    todayLikes: "Likes Today",
    todayComments: "Comments Today",
    styleKeywords: "Style Profile",
    fanDemographics: "Audience",
    ageDistribution: "Age",
    genderSplit: "Gender",
    topRegions: "Regions",
    latestInsights: "Latest Insights",
    male: "Male",
    female: "Female",

    // Memory
    memory: "Memory",
    styleProfile: "Style Profile",
    learnedRules: "Learned Rules",
    memorySearch: "Search memory",

    // Assets
    assets: "Assets",
    output: "Output",
    downloadAll: "Download All",
    noAssetsYet: "No assets yet",
    uploadAsset: "Upload",

    // Settings
    settingsTitle: "Settings",
    languageSetting: "Language",
    themeSetting: "Theme",
    darkTheme: "Dark",
    lightTheme: "Light",
  },
  zh: {
    // Navigation
    explore: "灵感",
    works: "作品",
    analytics: "数据",
    settings: "设置",

    // Common
    saveChanges: "保存",
    saving: "保存中...",
    settingsSaved: "已保存",
    settingsSaveFailed: "保存失败",
    loading: "加载中...",
    cancel: "取消",
    create: "创建",
    send: "发送",
    done: "完成",
    back: "返回",
    delete: "删除",
    confirmDelete: "确认删除？",

    // Works page
    myWorks: "作品",
    workList: "作品列表",
    newWork: "新建",
    abortTask: "中止",
    resumeTask: "继续",
    abortedMessage: "已中止生成",
    pipelineSteps: "流水线",
    noWorks: "还没有作品",
    noDrafts: "没有草稿",
    noDraftsDesc: "所有作品都已发布",
    noPublished: "没有已发布的作品",
    noPublishedDesc: "完成创作后发布你的第一个作品",
    createFirstWork: "创建你的第一个作品",
    filterAll: "全部",
    filterDraft: "草稿",
    filterPublished: "已发布",
    shortVideo: "短视频",
    imageText: "图文",

    // Work status
    workDraft: "草稿",
    workCreating: "草稿",
    workReady: "已发布",
    workFailed: "失败",
    monitoring: "监测中",

    // Insight banner
    autoResearchLabel: "自动调研",
    insightBannerWithData: "在你离开的时候，我调研了 {competitors} 个竞品，总结出了 ",
    inspirationTitle: "爆款思路",
    insightBannerEmpty: "开启「自动调研」，让 AI 在你不在时自动发现爆款灵感",
    viralIdeas: " 个爆款思路",
    viralIdeasSuffix: "。",

    // NewWorkModal
    newWorkTitle: "新建作品",
    selectType: "内容形式",
    videoSource: "视频来源",
    videoSourceUpload: "自己上传",
    videoSourceSearch: "全网搜索",
    videoSourceAI: "AI 生成",
    videoSourceUploadHint: "上传已有的视频素材",
    videoSourceSearchHint: "AI 在网上搜索并下载匹配的视频",
    videoSourceAIHint: "使用即梦 AI 生成视频片段",
    videoSearchPlaceholder: "描述你想搜索的视频内容...",
    contentCategory: "内容品类",
    categoryInfo: "知识",
    categoryBeauty: "审美",
    categoryComedy: "搞笑",
    categoryInfoDesc: "教程、干货、知识分享",
    categoryBeautyDesc: "颜值、舞蹈、穿搭",
    categoryComedyDesc: "搞笑短剧、抽象内容",
    resultTitle: "标题",
    titlePlaceholder: "可选，不填则 AI 自动生成",
    topicHint: "创作方向",
    topicHintPlaceholder: "你想做什么内容？（可选）",

    // Platforms
    xiaohongshu: "小红书",
    douyin: "抖音",

    // Studio
    studio: "工作台",
    chatPlaceholder: "你想如何修改方案？",
    emptyChat: "开始对话",
    sessionConnecting: "连接中...",
    sessionReady: "就绪",
    sessionCompleted: "已完成",
    nextStep: "下一步",
    redoStep: "重做",
    publish: "发布",
    backToHome: "返回",
    chatMode: "对话",
    canvasMode: "画布",

    // Pipeline steps
    stepPendingLabel: "待开始",
    stepRunningLabel: "进行中...",
    stepCompletedLabel: "已完成",
    stepFailedLabel: "失败",
    stepMaterialSearch: "素材搜索",
    stepResearch: "调研",
    stepPlan: "策划",
    stepAssets: "素材",
    stepAssembly: "合成",

    // Tool display names
    toolSearching: "正在搜索...",
    toolFetching: "正在获取网页...",
    toolRunning: "正在执行命令...",
    toolReading: "正在读取文件...",
    toolWriting: "正在写入文件...",
    toolEditing: "正在编辑文件...",
    toolGrepping: "正在搜索代码...",
    toolGlobbing: "正在查找文件...",
    toolDefault: "正在执行 {name}...",

    // Research progress
    researchDone: "调研完成",

    // Explore / Inspiration page
    startResearch: "开始调研",
    cancelResearch: "取消调研",
    loadingTrends: "加载趋势数据中...",
    emptyTrendsTitle: "暂无趋势数据",
    emptyTrendsDesc: "点击「想新思路」后等待片刻",
    viralHook: "爆款钩子",
    createFromTrend: "以此创建",

    // Explore — platform tabs
    douyinTab: "抖音",
    xiaohongshuTab: "小红书",
    douyinTrending: "抖音热门",
    xiaohongshuTrending: "小红书热门",

    // Interest tags
    following: "关注中",

    // Config
    researchConfig: "调研配置",
    researchInterval: "调研频率",
    aiModel: "AI 模型",
    autoResearch: "自动调研",
    claudeHaikuFast: "Haiku（快速）",
    claudeSonnetBalanced: "Sonnet（平衡）",
    claudeOpusCapable: "Opus（最强）",
    minutes15: "15 分钟",
    minutes30: "30 分钟",
    hour1: "1 小时",
    hours2: "2 小时",
    hours4: "4 小时",
    hours8: "8 小时",

    // Analytics
    followers: "粉丝",
    todayLikes: "今日点赞",
    todayComments: "今日评论",
    styleKeywords: "风格画像",
    fanDemographics: "粉丝画像",
    ageDistribution: "年龄分布",
    genderSplit: "性别比例",
    topRegions: "地区分布",
    latestInsights: "最新洞察",
    male: "男",
    female: "女",

    // Memory
    memory: "记忆",
    styleProfile: "风格画像",
    learnedRules: "已学规则",
    memorySearch: "搜索记忆",

    // Assets
    assets: "素材",
    output: "成品",
    downloadAll: "下载全部",
    noAssetsYet: "暂无素材",
    uploadAsset: "自己上传",

    // Settings
    settingsTitle: "设置",
    languageSetting: "语言",
    themeSetting: "主题",
    darkTheme: "深色",
    lightTheme: "浅色",
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
