import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0010 AE E2E 尾声揪出的真实死链：号池换号（或 CLI 本地会话库被清）后，
// 旧 work sidecar 里的 cliSessionId 在当前 `claude` 账号下不存在，`--resume`
// 立刻 stderr "No conversation found with session ID: …" + exit 1、零输出。
// ws-bridge 此前对这条路径零兜底（且 cli_stderr 只广播不落盘）——用户看到的
// 是永远沉默的 chat，日志里只有无法归因的 cli_exit code 1。
//
// 本文件钉死三件事（spawn-mock 模式照抄 ws-bridge-chat-backend.test.ts）：
//   1. stale-resume 检测 → 清 sidecar 死 id → 自动免 --resume 重生一次；
//   2. 重生 spawn 天然无 resumeId，同类失败不会无限循环；
//   3. 无关的 exit 1（stderr 不匹配）绝不触发兜底，cliSessionId 保留。

const spawnCalls: { cmd: string; args: string[]; options: any }[] = [];
const procs: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }> = [];

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  procs.push(proc);
  return proc;
}
vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], options: any) => {
    spawnCalls.push({ cmd, args, options });
    return makeFakeProc();
  },
}));

// logger.ts resolves LOG_DIR from homedir() at module load — redirect it into
// the temp dir so (a) the cli_stderr 落盘 assertion can find the file and
// (b) these tests never append into the REAL ~/.autoviral/logs（repo 教训：
// 测试污染真实 ~/.autoviral 的唯一根治是 mock node:os homedir）。
let fakeHome = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome || actual.homedir() };
});

beforeEach(() => {
  spawnCalls.length = 0;
  procs.length = 0;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.AUTOVIRAL_DATA_DIR;
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-staleresume-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  fakeHome = dir;
  try {
    return await fn(dir);
  } finally {
    fakeHome = "";
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dieWithStaleResume(proc: (typeof procs)[number], staleId: string): void {
  proc.stderr.emit(
    "data",
    Buffer.from(`No conversation found with session ID: ${staleId}\n`),
  );
  proc.emit("exit", 1, null);
}

describe("WsBridge — stale --resume 兜底（No conversation found → 清 id + 免 resume 重生）", () => {
  it("stale resume 死亡后：sidecar 死 id 被清 + 自动重生一次且不带 --resume", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID, PROMPT_VERSION } = await import(
        "../../../ws-bridge.js"
      );
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_stale";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-dead",
      });
      await sidecar.patch(DEFAULT_CHAT_SESSION_ID, {
        lastInjectedPromptVersion: PROMPT_VERSION,
      });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].args).toContain("--resume");
      expect(spawnCalls[0].args).toContain("cli-dead");

      dieWithStaleResume(procs[0], "cli-dead");
      await sleep(80); // 兜底路径经 getWork/prompt 重建，异步

      // 自动重生：第二个 spawn，且不带 --resume
      expect(spawnCalls).toHaveLength(2);
      expect(spawnCalls[1].args).not.toContain("--resume");

      // sidecar 里的死 id 被清掉，下次 resume 不会再撞
      const rec = await new SessionSidecar(work, dir).get(DEFAULT_CHAT_SESSION_ID);
      expect(rec?.cliSessionId).toBeUndefined();
    });
  });

  it("重生 spawn 再失败不会无限循环（fresh 无 resumeId，检测天然不触发）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_noloop";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-dead-2",
      });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      dieWithStaleResume(procs[0], "cli-dead-2");
      await sleep(80);
      expect(spawnCalls).toHaveLength(2);

      // 重生的那个也死于同样文案（假设环境彻底坏掉）——不得再 spawn 第三次
      dieWithStaleResume(procs[1], "whatever");
      await sleep(80);
      expect(spawnCalls).toHaveLength(2);
    });
  });

  it("无关 exit 1（stderr 不匹配）不触发兜底：不重生、cliSessionId 保留", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const { SessionSidecar } = await import("../sessions-sidecar.js");
      const work = "w_other_err";
      await mkdir(join(dir, "works", work), { recursive: true });
      const sidecar = new SessionSidecar(work, dir);
      await sidecar.create("chat", {
        now: new Date().toISOString(),
        id: DEFAULT_CHAT_SESSION_ID,
        cliSessionId: "cli-alive",
      });

      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "继续", undefined, DEFAULT_CHAT_SESSION_ID);
      procs[0].stderr.emit("data", Buffer.from("Error: rate limited, try again later\n"));
      procs[0].emit("exit", 1, null);
      await sleep(80);

      expect(spawnCalls).toHaveLength(1); // 不重生
      const rec = await new SessionSidecar(work, dir).get(DEFAULT_CHAT_SESSION_ID);
      expect(rec?.cliSessionId).toBe("cli-alive"); // id 保留
    });
  });

  it("cli_stderr 落盘：stderr 文本进 daemon 日志（可归因性）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      const work = "w_stderr_log";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "你好", undefined, DEFAULT_CHAT_SESSION_ID);
      procs[0].stderr.emit("data", Buffer.from("some diagnostic from the CLI\n"));
      await sleep(120); // 日志写盘是异步 fire-and-forget

      const logsDir = join(dir, ".autoviral", "logs");
      const files = await readdir(logsDir).catch(() => [] as string[]);
      expect(files.length).toBeGreaterThan(0);
      const all = (
        await Promise.all(files.map((f) => readFile(join(logsDir, f), "utf8")))
      ).join("\n");
      expect(all).toContain("cli_stderr");
      expect(all).toContain("some diagnostic from the CLI");
    });
  });
});
