import type { WsBridge } from "./ws-bridge.js";
export interface RunConfig {
    title?: string;
    type: "short-video" | "image-text";
    platform: "douyin" | "xiaohongshu";
    topicHint?: string;
    model?: string;
    stepTimeout?: number;
    stepMessages?: Record<string, string>;
}
export interface StepResult {
    key: string;
    name: string;
    status: "completed" | "failed" | "timeout";
    duration: number;
    messageCount: number;
    toolCalls: string[];
    error?: string;
}
export interface RunResult {
    runId: string;
    workId: string;
    config: RunConfig;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    duration?: number;
    steps: StepResult[];
    evaluation?: unknown;
    error?: string;
}
export declare function getRunStatus(runId: string): RunResult | undefined;
export declare function listRuns(): Promise<RunResult[]>;
export declare function getRunReport(runId: string): Promise<RunResult | null>;
export declare function runPipeline(wsBridge: WsBridge, config: RunConfig): Promise<RunResult>;
//# sourceMappingURL=test-runner.d.ts.map