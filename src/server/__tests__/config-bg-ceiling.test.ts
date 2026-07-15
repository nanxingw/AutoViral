import { describe, it, expect } from "vitest";
import { normalizeBgWaitCeilingMs } from "../../infra/config.js";

// PRD-0015 S5 修正包 · 配置校验（codex review 后续）。
//
// chat.bgWaitCeilingMs 会被 String() 后注入子进程的
// CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS。config.yaml 是运行时无类型的（YAML 可以放任意
// 标量），一个手滑的负数 / 小数 / 字符串 / NaN 一旦被 String() 塞进 env，claude CLI 的
// 解析行为不可控（NaN→"NaN"、-1→立即杀、1.5→截断）。所以在**消费前**校验：只接受
// 非负安全整数，非法值回落默认（返回 error 让 WsBridge 记日志），绝不把脏值 String() 出去。
//
// 纯函数、无副作用，先于消费点接线落盘并证红（此刻 normalizeBgWaitCeilingMs 尚不存在）。

describe("normalizeBgWaitCeilingMs — chat.bgWaitCeilingMs 校验", () => {
  it("未配置（undefined / null）→ 无 value 无 error（回落默认，不告警）", () => {
    expect(normalizeBgWaitCeilingMs(undefined)).toEqual({});
    expect(normalizeBgWaitCeilingMs(null)).toEqual({});
  });

  it("合法非负安全整数原样返回", () => {
    expect(normalizeBgWaitCeilingMs(0)).toEqual({ value: 0 });
    expect(normalizeBgWaitCeilingMs(5000)).toEqual({ value: 5000 });
    expect(normalizeBgWaitCeilingMs(600_000)).toEqual({ value: 600_000 });
    expect(normalizeBgWaitCeilingMs(Number.MAX_SAFE_INTEGER)).toEqual({
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it("负数 → error，不返回 value", () => {
    const r = normalizeBgWaitCeilingMs(-1);
    expect(r.value).toBeUndefined();
    expect(r.error).toMatch(/bgWaitCeilingMs/);
  });

  it("小数 → error", () => {
    const r = normalizeBgWaitCeilingMs(1.5);
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("字符串（含纯数字串）→ error，绝不当数字用", () => {
    expect(normalizeBgWaitCeilingMs("600000").value).toBeUndefined();
    expect(normalizeBgWaitCeilingMs("600000").error).toBeTruthy();
    expect(normalizeBgWaitCeilingMs("abc").error).toBeTruthy();
  });

  it("NaN / Infinity → error", () => {
    expect(normalizeBgWaitCeilingMs(NaN).error).toBeTruthy();
    expect(normalizeBgWaitCeilingMs(Infinity).error).toBeTruthy();
    expect(normalizeBgWaitCeilingMs(-Infinity).error).toBeTruthy();
  });

  it("超出安全整数范围 → error（不会静默丢精度后 String()）", () => {
    const r = normalizeBgWaitCeilingMs(Number.MAX_SAFE_INTEGER + 1);
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("布尔 / 对象等其它类型 → error", () => {
    expect(normalizeBgWaitCeilingMs(true).error).toBeTruthy();
    expect(normalizeBgWaitCeilingMs({}).error).toBeTruthy();
    expect(normalizeBgWaitCeilingMs([]).error).toBeTruthy();
  });
});
