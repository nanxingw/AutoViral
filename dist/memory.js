// EverMemOS Memory Integration — MemoryClient for AutoViral
// Connects to the EverMind API for persistent memory (style profiles, content history, etc.)
import { loadConfig } from "./config.js";
// ── MemoryClient ─────────────────────────────────────────────────────────────
const API_BASE = "https://api.evermind.ai/api/v0";
export class MemoryClient {
    apiKey;
    userId;
    constructor(apiKey, userId) {
        this.apiKey = apiKey;
        this.userId = userId;
    }
    /** Create a MemoryClient from the user's config. Returns null if not configured. */
    static async fromConfig() {
        const config = await loadConfig();
        const key = config.memory?.apiKey;
        const uid = config.memory?.userId;
        if (!key)
            return null;
        return new MemoryClient(key, uid ?? "autoviral-user");
    }
    isConfigured() {
        return !!this.apiKey;
    }
    async fetch(path, options = {}) {
        const url = `${API_BASE}${path}`;
        return globalThis.fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
                ...options.headers,
            },
        });
    }
    /** Search memories. Returns empty results on error. */
    async search(query, options = {}) {
        const empty = { memories: [], profiles: [] };
        try {
            const body = {
                user_id: this.userId,
                query,
                method: options.method ?? "hybrid",
                top_k: options.topK ?? 10,
                ...(options.memoryTypes ? { memory_types: options.memoryTypes } : {}),
                ...(options.groupIds ? { group_ids: options.groupIds } : {}),
            };
            const res = await this.fetch("/memories/search", {
                method: "GET",
                body: JSON.stringify(body),
            });
            if (!res.ok)
                return empty;
            const data = await res.json();
            return {
                memories: data.memories ?? [],
                profiles: data.profiles ?? [],
            };
        }
        catch {
            return empty;
        }
    }
    /** Add a memory entry. Silent fail on error. */
    async addMemory(payload) {
        try {
            const now = Date.now();
            const rand = Math.random().toString(36).slice(2, 8);
            const messageId = `autoviral_${now}_${rand}`;
            await this.fetch("/memories", {
                method: "POST",
                body: JSON.stringify({
                    user_id: this.userId,
                    message_id: messageId,
                    create_time: new Date(now).toISOString(),
                    sender: payload.senderName ?? "autoviral",
                    content: payload.content,
                    group_id: payload.groupId,
                    group_name: payload.groupName,
                    role: payload.role ?? "assistant",
                }),
            });
        }
        catch {
            // silent fail
        }
    }
    /**
     * Build a rich context block for a given work topic and platform.
     * Runs 4 parallel searches and assembles a markdown block.
     * Returns empty string if not configured.
     */
    async buildContext(workTopic, platform) {
        if (!this.isConfigured())
            return "";
        try {
            const [relatedContent, styleProfile, platformRules, competitor] = await Promise.all([
                this.search(`${workTopic} 相关创作内容`, { method: "hybrid", topK: 5, memoryTypes: ["episode"] }),
                this.search("我的内容风格 创作偏好", { method: "vector", topK: 5, memoryTypes: ["core", "profile"] }),
                this.search(`${platform} 平台规则 算法推荐`, { method: "keyword", topK: 5 }),
                this.search(`${workTopic} 竞品 热门内容`, { method: "hybrid", topK: 5 }),
            ]);
            const sections = [];
            // 风格画像
            const styleItems = [
                ...styleProfile.profiles.map(p => `- [${p.category}] ${p.trait_name}: ${p.description}`),
                ...styleProfile.memories.map(m => `- ${m.summary ?? m.content}`),
            ];
            if (styleItems.length > 0) {
                sections.push(`## 风格画像\n${styleItems.join("\n")}`);
            }
            // 平台规则
            const ruleItems = platformRules.memories.map(m => `- ${m.summary ?? m.content}`);
            if (ruleItems.length > 0) {
                sections.push(`## 平台规则\n${ruleItems.join("\n")}`);
            }
            // 相关历史创作
            const historyItems = relatedContent.memories.map(m => `- ${m.summary ?? m.content}`);
            if (historyItems.length > 0) {
                sections.push(`## 相关历史创作\n${historyItems.join("\n")}`);
            }
            // 竞品动态
            const compItems = competitor.memories.map(m => `- ${m.summary ?? m.content}`);
            if (compItems.length > 0) {
                sections.push(`## 竞品动态\n${compItems.join("\n")}`);
            }
            if (sections.length === 0)
                return "";
            return `# EverMemOS 记忆上下文\n\n${sections.join("\n\n")}`;
        }
        catch {
            return "";
        }
    }
}
//# sourceMappingURL=memory.js.map