import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: number;
  model: string;
  openrouter?: { apiKey: string };
  // #60 — jimeng (火山引擎/即梦) cloud credentials. Present in real on-disk
  // configs but was never declared here, so the GET /api/config redaction
  // sweep couldn't "see" it and leaked accessKey/secretKey in plaintext via
  // the untyped `...config` spread. Declaring it makes the secret path typed
  // and enumerable by SECRET_PATHS (src/server/api.ts).
  jimeng?: { accessKey?: string; secretKey?: string };
  memory?: { apiKey: string; userId: string; syncEnabled: boolean };
  // PRD-0015 S5 —— Studio chat 后端行为微调。目前仅 bgWaitCeilingMs：claude CLI
  // print-mode 的后台任务等待上限（ms），注入子进程的
  // CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS。省略时后端用 ADR-015 默认值 0（无限等待，
  // result 帧不被 hold）；运维想要止损上限（如 600000）时在 config.yaml 里设。
  chat?: { bgWaitCeilingMs?: number };
}

// AUTOVIRAL_DATA_DIR relocates ALL on-disk state (works, trends AND config.yaml)
// so tests can run fully isolated. Previously CONFIG_DIR was pinned to homedir
// and ignored the override, so loadConfig/saveConfig always hit the real
// ~/.autoviral/config.yaml — any test that persisted config clobbered the user's
// file. Honour the override here too (production leaves the env var unset, so the
// path is unchanged). Resolved at module load — tests use vi.resetModules.
const CONFIG_DIR = process.env.AUTOVIRAL_DATA_DIR ?? join(homedir(), ".autoviral");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

/** Base data directory for works, trends, etc.
 *  Tests can override via AUTOVIRAL_DATA_DIR; resolved at module load. */
export const dataDir = CONFIG_DIR;

/** Repo root directory — used by the rubric reader and any code that needs
 *  to load files shipped with the package. Resolves to the parent of the
 *  directory containing this module (src/ in dev, dist/ in prod). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function getDefaultConfig(): Config {
  return {
    port: 3271,
    model: "opus",
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function loadConfig(): Promise<Config> {
  await ensureDir(CONFIG_DIR);
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = yaml.load(raw) as (
      Partial<Config> & { research?: unknown; analytics?: unknown; interests?: unknown }
    ) | null;
    const {
      research: _retiredResearch,
      analytics: _retiredAnalytics,
      interests: _retiredInterests,
      ...activeConfig
    } = parsed ?? {};
    const config: Config = { ...getDefaultConfig(), ...activeConfig };

    // .env overrides
    if (process.env.OPENROUTER_API_KEY) {
      config.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
    }
    if (process.env.EVERMEMOS_API_KEY) {
      if (!config.memory) {
        config.memory = { apiKey: "", userId: "autoviral-user", syncEnabled: false };
      }
      config.memory.apiKey = process.env.EVERMEMOS_API_KEY;
    }

    return config;
  } catch {
    const config = getDefaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureDir(CONFIG_DIR);
  const raw = yaml.dump(config, { lineWidth: -1 });
  await writeFile(CONFIG_PATH, raw, "utf-8");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * PRD-0015 S5 —— 校验 `chat.bgWaitCeilingMs`（注入子进程的
 * CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS 之前）。config.yaml 是运行时无类型的（YAML
 * 标量可以是任意值），一个手滑的负数 / 小数 / 字符串 / NaN 一旦被 `String()` 塞进 env，
 * claude CLI 的解析行为不可控（`NaN`→立即杀 / 截断 / 未定义）。因此只接受**非负安全整数**；
 * 非法值不返回 `value`（消费点回落 ADR-015 默认 0）并附带 `error` 供调用方记日志——
 * 绝不把脏值 String() 出去。未配置（undefined/null）返回 `{}`（回落默认但不告警）。
 */
export function normalizeBgWaitCeilingMs(raw: unknown): { value?: number; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isSafeInteger(raw) ||
    raw < 0
  ) {
    return {
      error: `chat.bgWaitCeilingMs 必须是非负安全整数（ms），收到 ${JSON.stringify(raw)}；已回落默认（0=无限等待）。`,
    };
  }
  return { value: raw };
}
