import { describe, it, expect } from "vitest";
import { claudeBackend } from "../claude.js";

// PRD-0015 S5 —— spawn ceiling 止血。
// claude CLI 的 print-mode 自带"后台任务等待上限"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS
// （2.1.210 二进制内默认 600000ms）；满上限后 CLI 在子进程内强杀全部后台任务再吐
// result 帧退出——正是 030 事故的直接死因。本仓在 spawn env 里显式注入这个变量，默认
// 0（无限等待，见 ADR-015：result 帧不被 hold、chat UX 无损、任何有限值都会重演 030），
// 服务端配置可覆盖（运维想要止损上限时）。
//
// 这些断言先于实现落盘并证红（buildSpawn 尚未注入该 env 键）。

const SPAWN_BASE = { prompt: "hi", workId: "w1", serverPort: 3271 } as const;
const CEILING_KEY = "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS";

describe("claudeBackend.buildSpawn — CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS", () => {
  it("① 未配置时注入 ADR-015 定的默认值 '0'（无限等待）", () => {
    const d = claudeBackend.buildSpawn({ ...SPAWN_BASE });
    const env = d.options.env!;
    expect(env[CEILING_KEY]).toBe("0");
  });

  it("② 服务端配置可覆盖：bgWaitCeilingMs 透传为字符串", () => {
    const d = claudeBackend.buildSpawn({ ...SPAWN_BASE, bgWaitCeilingMs: 600_000 });
    expect(d.options.env![CEILING_KEY]).toBe("600000");

    const d2 = claudeBackend.buildSpawn({ ...SPAWN_BASE, bgWaitCeilingMs: 5000 });
    expect(d2.options.env![CEILING_KEY]).toBe("5000");
  });

  it("③ 显式 0 透传（无限等待，与默认同值但走覆盖路径）", () => {
    const d = claudeBackend.buildSpawn({ ...SPAWN_BASE, bgWaitCeilingMs: 0 });
    expect(d.options.env![CEILING_KEY]).toBe("0");
  });

  it("④ 既有 env 键不回归：注入 ceiling 不挤掉 AUTOVIRAL_* / CLAUDE_CODE_ENTRYPOINT / PATH", () => {
    const d = claudeBackend.buildSpawn({ ...SPAWN_BASE, workId: "w_env", serverPort: 4321 });
    const env = d.options.env!;
    // ceiling 已注入
    expect(env[CEILING_KEY]).toBe("0");
    // 且原有键逐一仍在（与 claude.test.ts 的 env 断言互为回归网）
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
    expect(env.AUTOVIRAL_WORK_ID).toBe("w_env");
    expect(env.AUTOVIRAL_PORT).toBe("4321");
    expect(typeof env.AUTOVIRAL_CWD).toBe("string");
    expect((env.AUTOVIRAL_CWD as string).endsWith("works/w_env")).toBe(true);
    expect(env.AUTOVIRAL_PROJECT_DIR).toBe(d.options.cwd);
    expect(typeof env.PATH).toBe("string");
    expect((env.PATH as string).length).toBeGreaterThan(0);
  });
});
