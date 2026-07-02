import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

// PRD-0010 C1 —— fixture 质量门。
// 这不是 parser 测试（那是 C3），而是断言"实测锚定的 codex 事件流 fixture 没有腐化"：
// 每行可 parse、必需事件类型齐全、README 记录了版本号。
// C3 的 parser 会直接消费这两份 JSONL，所以它们的完整性必须先被守住。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: { id?: string; type?: string; [k: string]: unknown };
  usage?: Record<string, number>;
}

async function loadJsonl(name: string): Promise<CodexEvent[]> {
  const raw = await readFile(join(__dirname, name), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as CodexEvent);
}

// 两份 fixture 都应满足的"一轮完整对话"契约。
const REQUIRED_TOP_LEVEL_TYPES = [
  "thread.started",
  "turn.started",
  "item.started",
  "item.completed",
  "turn.completed",
];

const USAGE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

const FIXTURES = ["exec-basic-tool-use.jsonl", "exec-resume.jsonl"];

describe("codex exec --json fixtures (C1 锚定)", () => {
  for (const fixture of FIXTURES) {
    describe(fixture, () => {
      it("每一行都是可 parse 的独立 JSON 对象", async () => {
        const events = await loadJsonl(fixture);
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) {
          expect(typeof e.type).toBe("string");
        }
      });

      it("包含一轮完整对话所需的全部顶层事件类型", async () => {
        const events = await loadJsonl(fixture);
        const seen = new Set(events.map((e) => e.type));
        for (const t of REQUIRED_TOP_LEVEL_TYPES) {
          expect(seen.has(t), `缺少事件类型 ${t}`).toBe(true);
        }
      });

      it("thread.started 携带 thread_id（UUID）", async () => {
        const events = await loadJsonl(fixture);
        const started = events.find((e) => e.type === "thread.started");
        expect(started?.thread_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      });

      it("含至少一个工具使用 item（command_execution），且 started/completed 靠 id 缝合", async () => {
        const events = await loadJsonl(fixture);
        const cmdStarted = events.find(
          (e) => e.type === "item.started" && e.item?.type === "command_execution",
        );
        const cmdDone = events.find(
          (e) => e.type === "item.completed" && e.item?.type === "command_execution",
        );
        expect(cmdStarted, "缺少 command_execution 的 item.started").toBeTruthy();
        expect(cmdDone, "缺少 command_execution 的 item.completed").toBeTruthy();
        // 同一命令的两次事件靠 item.id 缝合
        expect(cmdStarted?.item?.id).toBe(cmdDone?.item?.id);
        // 生命周期状态迁移：in_progress → completed
        expect(cmdStarted?.item?.status).toBe("in_progress");
        expect(cmdStarted?.item?.exit_code).toBeNull();
        expect(cmdDone?.item?.status).toBe("completed");
        expect(typeof cmdDone?.item?.exit_code).toBe("number");
      });

      it("含 agent_message item 且带 text", async () => {
        const events = await loadJsonl(fixture);
        const msg = events.find(
          (e) => e.type === "item.completed" && e.item?.type === "agent_message",
        );
        expect(msg, "缺少 agent_message item").toBeTruthy();
        expect(typeof msg?.item?.text).toBe("string");
        expect((msg?.item?.text as string).length).toBeGreaterThan(0);
      });

      it("turn.completed.usage 含全部 token 计数字段（均为整数）", async () => {
        const events = await loadJsonl(fixture);
        const done = events.find((e) => e.type === "turn.completed");
        expect(done?.usage).toBeTruthy();
        for (const f of USAGE_FIELDS) {
          expect(Number.isInteger(done?.usage?.[f]), `usage.${f} 应为整数`).toBe(true);
        }
      });
    });
  }

  it("resume fixture 复用与 basic fixture 相同的 thread_id", async () => {
    const basic = await loadJsonl("exec-basic-tool-use.jsonl");
    const resume = await loadJsonl("exec-resume.jsonl");
    const basicId = basic.find((e) => e.type === "thread.started")?.thread_id;
    const resumeId = resume.find((e) => e.type === "thread.started")?.thread_id;
    expect(basicId).toBeTruthy();
    expect(resumeId).toBe(basicId);
  });

  it("README 记录了 codex 版本号", async () => {
    const readme = await readFile(join(__dirname, "README.md"), "utf8");
    expect(readme).toMatch(/codex-cli\s+\d+\.\d+\.\d+/);
  });
});
