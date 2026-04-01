interface ConversationBlock {
    type: string;
    text: string;
    [key: string]: unknown;
}
export declare function syncStepConversation(workId: string, workTitle: string, stepKey: string, stepName: string, blocks: ConversationBlock[]): Promise<void>;
export {};
//# sourceMappingURL=memory-sync.d.ts.map