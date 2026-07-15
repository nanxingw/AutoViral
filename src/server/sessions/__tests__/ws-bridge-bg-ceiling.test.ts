import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PRD-0015 S5 修正包 · ensureBgWaitCeiling lazy-load 竞态修复（codex review 后续）。
//
// 事故前的实现把 `bgWaitCeilingLoaded = true` 在 `await loadConfig()` **之前**同步置位。
// 于是并发的第一批 spawn 里：第一个调用置位 loaded 后 await（loadConfig 尚未 resolve、
// bgWaitCeilingMs 仍是 undefined）；第二个调用看到 loaded=true 立刻短路返回，带着
// undefined 去 spawn → 它的子进程拿到默认 0 而不是运维配置的止损上限。修复：并发共享
// 同一个加载 Promise（都 await 到真正加载完），loaded 只在 await 成功后置位，加载失败
// 记日志且允许下次重试。
//
// 断言先于修复落盘并证红：现实现下第二个并发调用会在 loadConfig resolve 前就 settle。

// loadConfig 可控 mock：计数 + 手动 resolve/reject，逼出竞态窗口。
let loadConfigCalls = 0;
let resolveLoad: (() => void) | undefined;
let rejectLoad: (() => void) | undefined;
let nextConfig: Record<string, unknown> = { port: 3271, model: "opus", chat: { bgWaitCeilingMs: 600_000 } };

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
  loadConfigCalls = 0;
  resolveLoad = undefined;
  rejectLoad = undefined;
  nextConfig = { port: 3271, model: "opus", chat: { bgWaitCeilingMs: 600_000 } };
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function makeBridge() {
  const { WsBridge } = await import("../../../ws-bridge.js");
  return new WsBridge(3271) as unknown as {
    ensureBgWaitCeiling(): Promise<void>;
    bgWaitCeilingMs: number | undefined;
    bgWaitCeilingLoaded: boolean;
  };
}

describe("WsBridge.ensureBgWaitCeiling — lazy-load 竞态", () => {
  it("并发调用只触发一次 loadConfig，且都 await 到加载完成后才推进", async () => {
    const bridge = await makeBridge();

    const p1 = bridge.ensureBgWaitCeiling();
    const p2 = bridge.ensureBgWaitCeiling();
    let p2Settled = false;
    void p2.then(() => {
      p2Settled = true;
    });

    // 两个并发调用只应触发一次底层 loadConfig（共享 in-flight Promise）。
    expect(loadConfigCalls).toBe(1);

    // 关键反竞态断言：loadConfig 尚未 resolve 前，第二个并发调用 **不得** 提前 settle。
    // 旧实现里它看到同步置位的 loaded=true 会立刻返回 → 带着 undefined 去 spawn。
    await flushMicrotasks();
    expect(p2Settled).toBe(false);
    expect(bridge.bgWaitCeilingMs).toBeUndefined();
    expect(bridge.bgWaitCeilingLoaded).toBe(false);

    resolveLoad!();
    await Promise.all([p1, p2]);

    // 加载完成后两个调用都拿到配置值，loaded 才置位。
    expect(bridge.bgWaitCeilingMs).toBe(600_000);
    expect(bridge.bgWaitCeilingLoaded).toBe(true);
    expect(p2Settled).toBe(true);
    expect(loadConfigCalls).toBe(1);
  });

  it("加载成功后缓存，后续调用不再 loadConfig", async () => {
    const bridge = await makeBridge();
    const p1 = bridge.ensureBgWaitCeiling();
    resolveLoad!();
    await p1;
    expect(loadConfigCalls).toBe(1);

    await bridge.ensureBgWaitCeiling();
    await bridge.ensureBgWaitCeiling();
    expect(loadConfigCalls).toBe(1);
    expect(bridge.bgWaitCeilingMs).toBe(600_000);
  });

  it("加载失败不置位 loaded，下次调用重试并成功", async () => {
    const bridge = await makeBridge();

    const p1 = bridge.ensureBgWaitCeiling();
    rejectLoad!();
    await p1; // 失败被吞（记日志），不抛给 spawn 路径。

    expect(bridge.bgWaitCeilingLoaded).toBe(false);
    expect(bridge.bgWaitCeilingMs).toBeUndefined();
    expect(loadConfigCalls).toBe(1);

    // 下次调用应重新触发 loadConfig（不是永久锁死在失败态）。
    const p2 = bridge.ensureBgWaitCeiling();
    expect(loadConfigCalls).toBe(2);
    resolveLoad!();
    await p2;
    expect(bridge.bgWaitCeilingMs).toBe(600_000);
    expect(bridge.bgWaitCeilingLoaded).toBe(true);
  });

  it("配置里是非法值（负数）→ 回落默认（undefined），不塞脏值", async () => {
    nextConfig = { port: 3271, model: "opus", chat: { bgWaitCeilingMs: -1 } };
    const bridge = await makeBridge();
    const p1 = bridge.ensureBgWaitCeiling();
    resolveLoad!();
    await p1;
    // 非法 → 不缓存脏值；buildSpawn 会回落到 ADR-015 默认 0。
    expect(bridge.bgWaitCeilingMs).toBeUndefined();
    expect(bridge.bgWaitCeilingLoaded).toBe(true);
  });
});
