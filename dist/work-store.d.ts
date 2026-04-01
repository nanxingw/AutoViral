export type WorkType = "short-video" | "image-text";
export type WorkStatus = "draft" | "creating" | "ready" | "failed";
export interface PipelineStep {
    name: string;
    status: "pending" | "active" | "done" | "skipped";
    startedAt?: string;
    completedAt?: string;
    note?: string;
}
export type ContentCategory = "info" | "beauty" | "comedy" | "anxiety" | "conflict" | "envy";
export type VideoSource = "upload" | "search" | "ai-generate";
export interface Work {
    id: string;
    title: string;
    type: WorkType;
    contentCategory?: ContentCategory;
    videoSource?: VideoSource;
    videoSearchQuery?: string;
    status: WorkStatus;
    platforms: string[];
    pipeline: Record<string, PipelineStep>;
    cliSessionId?: string;
    coverImage?: string;
    topicHint?: string;
    titleLocked?: boolean;
    language?: "en" | "zh";
    createdAt: string;
    updatedAt: string;
}
/** Lightweight summary stored in the index file. */
export interface WorkSummary {
    id: string;
    title: string;
    type: WorkType;
    contentCategory?: ContentCategory;
    platforms?: string[];
    status: WorkStatus;
    updatedAt: string;
}
export declare function listWorks(): Promise<WorkSummary[]>;
export declare function getWork(id: string): Promise<Work | undefined>;
export declare function createWork(input: {
    title: string;
    type: WorkType;
    contentCategory?: ContentCategory;
    videoSource?: VideoSource;
    videoSearchQuery?: string;
    platforms: string[];
    topicHint?: string;
    language?: "en" | "zh";
}): Promise<Work>;
export declare function updateWork(id: string, updates: Partial<Work>): Promise<Work | undefined>;
export declare function deleteWork(id: string): Promise<boolean>;
/** Recursively list files in assets/ and output/ dirs, returning relative paths. */
export declare function listAssets(id: string): Promise<string[]>;
export declare function getAssetPath(id: string, filename: string): string;
/** Save execution history for a pipeline step. */
export declare function saveStepHistory(id: string, stepKey: string, data: unknown): Promise<void>;
/** Load execution history for a pipeline step. */
export declare function loadStepHistory(id: string, stepKey: string): Promise<unknown | null>;
/** Save full conversation to chat.json (single file per work). */
export declare function saveWorkChat(id: string, data: unknown): Promise<void>;
/** Load full conversation from chat.json. */
export declare function loadWorkChat(id: string): Promise<unknown | null>;
//# sourceMappingURL=work-store.d.ts.map