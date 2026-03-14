type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Hero
    heroTitle: "Your AI-Powered Content Creation Copilot",
    heroDesc: "6 intelligent tools covering every step of your content workflow — from research to analytics",

    // Workflow steps
    wf_research: "Research",
    wf_topic: "Topic Selection",
    wf_script: "Script & Copy",
    wf_produce: "Produce & Edit",
    wf_publish: "Publish",
    wf_analyze: "Feedback & Analytics",

    // Feature: Viral Generator
    feature_viral_name: "Viral Content Generator",
    feature_viral_desc: "Analyze viral videos to extract the winning DNA — hooks, pacing, formats that drive millions of views",

    // Feature: Hotspot Remix
    feature_hotspot_name: "Trending Topic Remix Engine",
    feature_hotspot_desc: "Automatically adapt trending topics into your unique style while staying authentic to your brand",

    // Feature: Timing Predictor
    feature_timing_name: "Golden Publish Time Predictor",
    feature_timing_desc: "Data-driven predictions for the optimal publishing window to maximize reach and engagement",

    // Feature: Pitfall Alert
    feature_pitfall_name: "Smart Pitfall Warning System",
    feature_pitfall_desc: "Get pre-creation alerts about common mistakes, platform policy risks, and lessons from past content",

    // Feature: Copywriting Evolution
    feature_copywriting_name: "Copywriting Style Evolver",
    feature_copywriting_desc: "Learn from your highest-engagement copy to continuously evolve and optimize your writing style",

    // Feature: Competitor Insight
    feature_competitor_name: "Competitor Differentiation Insight",
    feature_competitor_desc: "Discover your unique competitive advantages by analyzing competitor strategies and content gaps",

    // Feature Detail
    backToHome: "Back",
    researchConfig: "Research Configuration",
    researchInterval: "Research Interval",
    researchIntervalHint: "How often to run automated research cycles",
    aiModel: "AI Model",
    aiModelHint: "AI model for research agents",
    autoResearch: "Auto Research",
    autoResearchHint: "Automatically run research at set intervals",
    startResearch: "Start Research",
    researchingDots: "Researching...",
    researchStarted: "Research started successfully!",
    researchFailed: "Failed to start research.",
    researchReports: "Research Reports",
    noResearchReports: "No research reports yet. Start your first research to see results here.",

    // Config options
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
  },
  zh: {
    // Hero
    heroTitle: "AI 驱动的内容创作副驾驶",
    heroDesc: "6 大智能工具覆盖创作全流程 — 从选题调研到数据复盘",

    // Workflow steps
    wf_research: "调研",
    wf_topic: "选题",
    wf_script: "文案大纲",
    wf_produce: "拍摄剪辑",
    wf_publish: "发布",
    wf_analyze: "反馈分析",

    // Feature: Viral Generator
    feature_viral_name: "爆款生成器",
    feature_viral_desc: "分析爆款视频提取成功 DNA — 钩子、节奏、格式，找到百万播放的密码",

    // Feature: Hotspot Remix
    feature_hotspot_name: "热点个性化改编引擎",
    feature_hotspot_desc: "将实时热点自动改编成符合个人风格的内容，保持品牌调性的同时蹭上热度",

    // Feature: Timing Predictor
    feature_timing_name: "黄金发布时间预测",
    feature_timing_desc: "基于数据预测最佳发布窗口，最大化内容曝光和互动率",

    // Feature: Pitfall Alert
    feature_pitfall_name: "智能避坑预警系统",
    feature_pitfall_desc: "创作前提醒历史踩坑点、平台政策风险和过往内容的经验教训",

    // Feature: Copywriting Evolution
    feature_copywriting_name: "文案风格进化助手",
    feature_copywriting_desc: "基于高互动文案持续学习，不断优化和进化你的写作风格",

    // Feature: Competitor Insight
    feature_competitor_name: "竞品差异化洞察",
    feature_competitor_desc: "分析竞品策略和内容空白，找出你独特的竞争优势",

    // Feature Detail
    backToHome: "返回",
    researchConfig: "调研配置",
    researchInterval: "调研频率",
    researchIntervalHint: "自动调研的运行间隔",
    aiModel: "AI 模型",
    aiModelHint: "用于调研的 AI 模型",
    autoResearch: "自动调研",
    autoResearchHint: "按设定间隔自动运行调研",
    startResearch: "开始调研",
    researchingDots: "调研中...",
    researchStarted: "调研已成功启动！",
    researchFailed: "启动调研失败。",
    researchReports: "调研报告",
    noResearchReports: "暂无调研报告。启动首次调研后结果将在此显示。",

    // Config options
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
