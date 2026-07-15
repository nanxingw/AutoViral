import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

// PRD-0015 S5 修正包 · ensureBgWaitCeiling lazy-load 竞态修复（codex review finding 6）。
//
// 事故前的实现把 `bgWaitCeilingLoaded = true` 在 `await loadConfig()` **之前**同步置位。
// 于是并发的第一批 spawn 里：第一个调用置位 loaded 后 await（loadConfig 尚未 resolve、
// bgWaitCeilingMs 仍是 undefined）；第二个调用看到 loaded=true 立刻短路返回，带着 undefined
// 去 spawn → 它的子进程拿到默认 0 而不是运维配置的止损上限。修复：并发共享同一个加载 Promise，
// loaded 只在 await 成功后置位，加载失败记日志且允许下次重试。
//
// 本轮加固（finding 6）：断言不再直调 private（ensureBgWaitCeiling / bgWaitCeilingMs），改走
// 公开入口 createSession —— 并发触发 spawn，用 mock spawn 捕获子进程 env 里注入的
// CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS，从 spawn 面（真正被消费的地方）断言止损上限保真。
// spawn-mock 模式取自 ws-bridge-bg-registry.test.ts。

// ── mock spawn：捕获每次子进程的 env（buildSpawn 注入的止损上限落在 options.env）。
const spawnEnvs: Array<Record<string, string | undefined>> = [];
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  return proc;
}
vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, _args: string[], options?: { env?: Record<string, string | undefined> }) => {
    spawnEnvs.push(options?.env ?? {});
    return makeFakeProc();
  },
}));

// ── loadConfig 可控 mock：计数 + 手动 resolve/reject，逼出竞态窗口。dataDir /
//    normalizeBgWaitCeilingMs 等透传真实实现（ws-bridge 依赖它们做 sidecar 路径与校验）。
let loadConfigCalls = 0;
let resolveLoad: (() => void) | undefined;
let rejectLoad: (() => void) | undefined;
let nextConfig: Record<string, unknown> = {
  port: 3271,
  model: "opus",
  chat: { bgWaitCeilingMs: 600_000 },
};

vi.mock("../../../infra/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../infra/config.js")>();
  return {
    ...actual,
    loadConfig: () => {
      loadConfigCalls++;
      return new Promise((resolve, reject) => {
        resolveLoad = () => resolve(nextConfig);
        rejectLoad = () => reject(new Error("config read failed"));
      });
    },
  };
});

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  spawnEnvs.length = 0;
  loadConfigCalls = 0;
  resolveLoad = undefined;
  rejectLoad = undefined;
  nextConfig = { port: 3271, model: "opus", chat: { bgWaitCeilingMs: 600_000 } };
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTOVIRAL_DATA_DIR;
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-bg-ceiling-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

/** spawn 面读出的止损上限（子进程 env）。 */
function ceilingOf(env: Record<string, string | undefined>): string | undefined {
  return env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
}

describe("WsBridge — bgWaitCeiling 经公开入口 spawn 面保真", () => {
  it("并发 createSession 只触发一次 loadConfig，两个 spawn 都拿到配置的止损上限（反竞态）", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works", "w1"), { recursive: true });
      await mkdir(join(dir, "works", "w2"), { recursive: true });

      const bridge = new WsBridge(3271);
      const p1 = bridge.createSession("w1", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      const p2 = bridge.createSession("w2", "hi", undefined, DEFAULT_CHAT_SESSION_ID);

      // 两个并发 createSession 只应触发一次底层 loadConfig（共享 in-flight Promise）。
      expect(loadConfigCalls).toBe(1);

      // 关键反竞态：loadConfig 尚未 resolve 前两个调用都卡在 ensureBgWaitCeiling，谁都还没 spawn。
      await flushMicrotasks();
      expect(spawnEnvs).toHaveLength(0);

      resolveLoad!();
      await Promise.all([p1, p2]);

      // 两个子进程都拿到配置的止损上限（旧竞态下第二个会短路带 undefined → 默认 0）。
      expect(spawnEnvs).toHaveLength(2);
      for (const env of spawnEnvs) expect(ceilingOf(env)).toBe("600000");
      expect(loadConfigCalls).toBe(1);
    });
  });

  it("加载成功后缓存，后续 createSession 的 spawn 仍带止损上限且不再 loadConfig", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works", "w1"), { recursive: true });
      await mkdir(join(dir, "works", "w2"), { recursive: true });

      const bridge = new WsBridge(3271);
      const p1 = bridge.createSession("w1", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      resolveLoad!();
      await p1;
      expect(loadConfigCalls).toBe(1);
      expect(ceilingOf(spawnEnvs[0])).toBe("600000");

      await bridge.createSession("w2", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(loadConfigCalls).toBe(1); // 缓存命中，不再读配置。
      expect(ceilingOf(spawnEnvs[1])).toBe("600000");
    });
  });

  it("加载失败不置位 loaded：本次 spawn 回落默认，下次 createSession 重试并拿到上限", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works", "w1"), { recursive: true });
      await mkdir(join(dir, "works", "w2"), { recursive: true });

      const bridge = new WsBridge(3271);
      const p1 = bridge.createSession("w1", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      rejectLoad!(); // 加载失败被吞（记日志），不阻断 spawn。
      await p1;
      expect(loadConfigCalls).toBe(1);
      // 失败态：子进程回落 ADR-015 默认 0（无限等待，安全侧），不是崩。
      expect(ceilingOf(spawnEnvs[0])).toBe("0");

      // 下次 createSession 不永久锁死在失败态，重试 loadConfig 并成功。
      const p2 = bridge.createSession("w2", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      expect(loadConfigCalls).toBe(2);
      resolveLoad!();
      await p2;
      expect(ceilingOf(spawnEnvs[1])).toBe("600000");
    });
  });

  it("配置非法值（负数）不塞脏值：spawn env 回落默认 0，绝不出现 -1", async () => {
    await withTempDataDir(async (dir) => {
      nextConfig = { port: 3271, model: "opus", chat: { bgWaitCeilingMs: -1 } };
      const { WsBridge, DEFAULT_CHAT_SESSION_ID } = await import("../../../ws-bridge.js");
      await mkdir(join(dir, "works", "w1"), { recursive: true });

      const bridge = new WsBridge(3271);
      const p1 = bridge.createSession("w1", "hi", undefined, DEFAULT_CHAT_SESSION_ID);
      resolveLoad!();
      await p1;
      // 非法 → 不缓存脏值；buildSpawn 回落 ADR-015 默认 0。脏值 -1 绝不进子进程 env。
      expect(ceilingOf(spawnEnvs[0])).toBe("0");
      expect(ceilingOf(spawnEnvs[0])).not.toBe("-1");
    });
  });
});
