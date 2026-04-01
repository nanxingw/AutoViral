export interface CreatorData {
    platform: string;
    collected_at: string;
    account: {
        nickname: string;
        follower_count: number;
        following_count: number;
        total_favorited: number;
        aweme_count: number;
        [key: string]: unknown;
    };
    works: Array<{
        aweme_id: string;
        desc: string;
        create_time: number;
        play_count: number;
        digg_count: number;
        comment_count: number;
        share_count: number;
        collect_count: number;
        [key: string]: unknown;
    }>;
    summary: {
        total_works_collected: number;
        avg_play: number;
        avg_digg: number;
        avg_comment: number;
        avg_share: number;
        avg_collect: number;
        engagement_rate: number;
    };
}
export declare function getLatestCreatorData(): Promise<CreatorData | null>;
export declare function getCreatorHistory(days?: number): Promise<Array<{
    date: string;
    data: CreatorData;
}>>;
export declare function startAnalyticsCollector(): Promise<void>;
export declare function stopAnalyticsCollector(): void;
//# sourceMappingURL=analytics-collector.d.ts.map