export interface MemoryPayload {
    content: string;
    groupId: string;
    groupName: string;
    role?: string;
    senderName?: string;
}
export interface SearchOptions {
    method?: "keyword" | "vector" | "hybrid" | "agentic";
    topK?: number;
    memoryTypes?: string[];
    groupIds?: string[];
}
export interface MemoryEntry {
    memory_id: string;
    memory_type: string;
    content: string;
    summary?: string;
    score: number;
    timestamp: string;
}
export interface ProfileEntry {
    item_type: string;
    category: string;
    trait_name: string;
    description: string;
    score: number;
}
export interface SearchResult {
    memories: MemoryEntry[];
    profiles: ProfileEntry[];
}
export declare class MemoryClient {
    private apiKey;
    private userId;
    constructor(apiKey: string, userId: string);
    /** Create a MemoryClient from the user's config. Returns null if not configured. */
    static fromConfig(): Promise<MemoryClient | null>;
    isConfigured(): boolean;
    private fetch;
    /** Search memories. Returns empty results on error. */
    search(query: string, options?: SearchOptions): Promise<SearchResult>;
    /** Add a memory entry. Silent fail on error. */
    addMemory(payload: MemoryPayload): Promise<void>;
    /**
     * Build a rich context block for a given work topic and platform.
     * Runs 4 parallel searches and assembles a markdown block.
     * Returns empty string if not configured.
     */
    buildContext(workTopic: string, platform: string): Promise<string>;
}
//# sourceMappingURL=memory.d.ts.map