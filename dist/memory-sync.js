import { MemoryClient } from "./memory.js";
import { loadConfig } from "./config.js";
export async function syncStepConversation(workId, workTitle, stepKey, stepName, blocks) {
    try {
        const config = await loadConfig();
        if (!config.memory?.syncEnabled || !config.memory?.apiKey)
            return;
        const client = new MemoryClient(config.memory.apiKey, config.memory.userId || "autoviral-user");
        const filtered = blocks.filter(b => b.type === "user" || b.type === "text");
        if (filtered.length === 0)
            return;
        const lines = filtered.map(b => {
            const role = b.type === "user" ? "用户" : "助手";
            return `${role}: ${b.text}`;
        });
        const content = [
            `# ${workTitle} — ${stepName}`,
            `日期: ${new Date().toISOString().slice(0, 10)}`,
            "",
            ...lines,
        ].join("\n");
        await client.addMemory({
            content,
            groupId: workId,
            groupName: `${workTitle} — ${stepName}`,
            role: "conversation",
        });
        console.log(`[memory-sync] Synced ${filtered.length} messages for ${workTitle}/${stepName}`);
    }
    catch (err) {
        console.error("[memory-sync] Sync failed (non-blocking):", err instanceof Error ? err.message : err);
    }
}
//# sourceMappingURL=memory-sync.js.map