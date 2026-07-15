import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  slugifyProjectPath,
  parseJournalCounts,
  harvestWorkflowJournal,
} from "../sessions/journal-harvest.js";

// PRD-0015 S7 —— Journal 打捞 orphaned。
//
// 宿主进程死亡且 registry 有未终态任务时，从对应 workflow journal 收割【已完成
// agent 的计数】（可见性 + 止损，不自动重跑）。真值取自事故 journal 的脱敏副本
// （__fixtures__/journal-harvest/journal.jsonl）——含 resume 重复 key 场景：同一
// 个 agent key 被 resume 以【新 agentId】重跑一次，收割必须按 journal `key` 去重、
// 绝不按行数（否则重复计费的那一次会把完成数虚高）。
//
// 目录推导对照本机事故现场：cwd = 生产的 PACKAGE_ROOT（.../autoviral/dist）
// slugify 成 `-Users-nanjiayan-Desktop-AutoViral-autoviral-dist`，journal 落在
// ~/.claude/projects/<slug>/<cliSessionId>/subagents/workflows/<runId>/journal.jsonl。
// slug 规则 = 路径里每个非字母数字字符 → '-'（无折叠，实录印证 `docs----OpenCut`）。

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "__fixtures__", "journal-harvest");

const CLI_SESSION_ID = "a75f4a6e-dccf-405a-8f7e-6941dc3943e9";
const CWD = "/Users/nanjiayan/Desktop/AutoViral/autoviral/dist";
const RUN_ID = "wf_sanitized-a1b";

let home: string;

/** 把 fixture journal 铺进临时 home 的派生路径里（模拟真实事故现场目录结构），返回
 *  workflows/<runId>/journal.jsonl 的绝对路径。 */
async function seedJournal(fixtureName: string, runId = RUN_ID): Promise<string> {
  const slug = slugifyProjectPath(CWD);
  const runDir = join(
    home,
    ".claude",
    "projects",
    slug,
    CLI_SESSION_ID,
    "subagents",
    "workflows",
    runId,
  );
  await mkdir(runDir, { recursive: true });
  const journalPath = join(runDir, "journal.jsonl");
  const raw = readFileSync(join(FIXTURE_DIR, fixtureName), "utf8");
  await writeFile(journalPath, raw, "utf8");
  return journalPath;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-journal-harvest-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("slugifyProjectPath — claude project-dir 目录名规则", () => {
  it("每个非字母数字字符 → 单个 '-'（无折叠，对照事故现场 dist 目录名）", () => {
    expect(slugifyProjectPath("/Users/nanjiayan/Desktop/AutoViral/autoviral/dist")).toBe(
      "-Users-nanjiayan-Desktop-AutoViral-autoviral-dist",
    );
    // 连续非字母数字不折叠（实录 `docs----OpenCut` = 4 个分隔符 → 4 个 dash）。
    expect(slugifyProjectPath("/a/docs/ - OpenCut")).toBe("-a-docs----OpenCut");
  });
});

describe("parseJournalCounts — 按 journal key 去重（非行数）", () => {
  it("② resume 重复 key 只计一次完成（同 key 两个 agentId）", () => {
    const raw = readFileSync(join(FIXTURE_DIR, "journal.jsonl"), "utf8");
    const counts = parseJournalCounts(raw);
    // 3 个 result 行、但只有 2 个唯一 key（aaa 被 resume 以新 agentId 重跑）。
    expect(counts).toEqual({ completedAgents: 2, startedAgents: 3 });
  });

  it("空 / 全损坏文本 → null（无一行可解析）", () => {
    expect(parseJournalCounts("")).toBeNull();
    expect(parseJournalCounts(readFileSync(join(FIXTURE_DIR, "journal-corrupt.jsonl"), "utf8"))).toBeNull();
  });
});

describe("harvestWorkflowJournal — 派生路径 + 收割计数", () => {
  it("① 从事故 journal 收割出正确的完成/总计数与 runId/journalPath", async () => {
    const journalPath = await seedJournal("journal.jsonl");
    const result = await harvestWorkflowJournal({ cliSessionId: CLI_SESSION_ID, cwd: CWD, homeDir: home });
    expect(result).not.toBeNull();
    expect(result!.runId).toBe(RUN_ID);
    expect(result!.completedAgents).toBe(2);
    expect(result!.startedAgents).toBe(3);
    expect(result!.journalPath).toBe(journalPath);
  });

  it("③ journal 缺失 → null（优雅降级，settle 保持 stopped 无打捞）", async () => {
    // 派生的 workflows 目录根本不存在。
    const result = await harvestWorkflowJournal({ cliSessionId: CLI_SESSION_ID, cwd: CWD, homeDir: home });
    expect(result).toBeNull();
  });

  it("③ journal 损坏（无可解析行）→ null", async () => {
    await seedJournal("journal-corrupt.jsonl");
    const result = await harvestWorkflowJournal({ cliSessionId: CLI_SESSION_ID, cwd: CWD, homeDir: home });
    expect(result).toBeNull();
  });

  it("多 run 目录时取 journal 最新修改的那个 run", async () => {
    // 先铺一个较老的 run，再铺目标 run（后写 = mtime 更新）。
    await seedJournal("journal-corrupt.jsonl", "wf_older-run");
    const journalPath = await seedJournal("journal.jsonl", RUN_ID);
    const result = await harvestWorkflowJournal({ cliSessionId: CLI_SESSION_ID, cwd: CWD, homeDir: home });
    expect(result).not.toBeNull();
    expect(result!.runId).toBe(RUN_ID);
    expect(result!.journalPath).toBe(journalPath);
  });
});
