import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Spawn-mock pattern mirrors ws-bridge-resume-prompt.test.ts.
const spawnCalls: Array<{ cmd: string; args: string[]; proc: FakeProc }> = [];
type FakeProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}
vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    const proc = makeFakeProc();
    spawnCalls.push({ cmd, args, proc });
    return proc;
  },
}));

beforeEach(() => {
  spawnCalls.length = 0;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.AUTOVIRAL_DATA_DIR;
});

async function withTempDataDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ws-slash-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
  }
}

function emit(proc: FakeProc, frame: Record<string, unknown>): void {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
}

function fakeBrowserSocket(frames: any[]): never {
  return {
    readyState: 1,
    send: (data: string) => frames.push(JSON.parse(data)),
  } as never;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("WsBridge structured slash commands", () => {
  it("routes Claude /compact as an exact positional prompt and pushes dynamic capabilities", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_compact";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hello", undefined, "s_1", "claude");
      const frames: any[] = [];
      bridge.getSession(work, "s_1")!.browserSockets.add(fakeBrowserSocket(frames));
      emit(spawnCalls[0].proc, {
        type: "system",
        subtype: "init",
        session_id: "cli-compact",
        slash_commands: ["compact"],
        skills: [],
      });
      emit(spawnCalls[0].proc, { type: "result", result: "ready" });

      await bridge.sendCommand(work, "compact", "", "s_1");
      await tick();

      const args = spawnCalls.at(-1)!.args;
      expect(args[args.indexOf("-p") + 1]).toBe("/compact");
      expect(args.join(" ")).not.toContain("<viewer-context>");
      expect(args.join(" ")).not.toContain("<attachments>");
      expect(args.join(" ")).not.toContain("用户消息：");
      expect(args).not.toContain("--append-system-prompt");
      expect(frames.some((frame) =>
        frame.event === "chat_capabilities" &&
        frame.data.commands.some((entry: any) => entry.name === "compact" && entry.availability.available)
      )).toBe(true);
      spawnCalls.at(-1)!.proc.emit("exit", 0, null);
      await bridge.flushChatLogs();
    });
  });

  it("routes /model haiku through the session setter and the next ordinary spawn carries --model haiku", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_model";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hello", undefined, "s_1", "claude");
      bridge.getSession(work, "s_1")!.browserSockets.add(fakeBrowserSocket([]));
      emit(spawnCalls[0].proc, { type: "system", subtype: "init", session_id: "cli-model" });
      emit(spawnCalls[0].proc, { type: "result", result: "ready" });

      await bridge.sendCommand(work, "model", "haiku", "s_1");
      expect(bridge.getSession(work, "s_1")?.model).toBe("haiku");
      expect(spawnCalls).toHaveLength(1);

      await bridge.sendMessage(work, "ordinary follow-up", "s_1");
      const args = spawnCalls.at(-1)!.args;
      expect(args[args.indexOf("--model") + 1]).toBe("haiku");
      expect(args[args.indexOf("-p") + 1]).toBe("ordinary follow-up");
      spawnCalls.at(-1)!.proc.emit("exit", 0, null);
      await bridge.flushChatLogs();
    });
  });

  it("dedupes a busy repeated provider command and rejects it after disconnect", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_busy";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hello", undefined, "s_1", "claude");
      const socket = fakeBrowserSocket([]);
      bridge.getSession(work, "s_1")!.browserSockets.add(socket);
      emit(spawnCalls[0].proc, {
        type: "system", subtype: "init", session_id: "cli-busy", slash_commands: ["compact"], skills: [],
      });
      emit(spawnCalls[0].proc, { type: "result", result: "ready" });

      await bridge.sendCommand(work, "compact", "", "s_1");
      const commandProc = spawnCalls.at(-1)!.proc;
      const duplicate = await bridge.sendCommand(work, "compact", "", "s_1");
      expect(duplicate).toMatchObject({ status: "ok", deduped: true });
      expect(spawnCalls).toHaveLength(2);
      expect(commandProc.kill).not.toHaveBeenCalled();

      bridge.getSession(work, "s_1")!.browserSockets.delete(socket);
      const disconnected = await bridge.sendCommand(work, "compact", "", "s_1");
      expect(disconnected).toMatchObject({
        status: "unsupported",
        errorCode: "unsupported_command",
      });
      expect(commandProc.kill).not.toHaveBeenCalled();
      commandProc.emit("exit", 0, null);
      await bridge.flushChatLogs();
    });
  });

  it("broadcasts command_error, restores idle after spawn error, and accepts a retry", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_recover";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hello", undefined, "s_1", "claude");
      const frames: any[] = [];
      bridge.getSession(work, "s_1")!.browserSockets.add(fakeBrowserSocket(frames));
      emit(spawnCalls[0].proc, {
        type: "system", subtype: "init", session_id: "cli-recover", slash_commands: ["compact"], skills: [],
      });
      emit(spawnCalls[0].proc, { type: "result", result: "ready" });

      await bridge.sendCommand(work, "compact", "", "s_1");
      const failed = spawnCalls.at(-1)!.proc;
      failed.emit("error", Object.assign(new Error("spawn exploded"), { code: "EACCES" }));
      await tick();
      expect(bridge.getSession(work, "s_1")?.idle).toBe(true);
      expect(frames.some((frame) => frame.event === "command_error")).toBe(true);

      await bridge.sendCommand(work, "compact", "", "s_1");
      expect(spawnCalls).toHaveLength(3);
      spawnCalls.at(-1)!.proc.emit("exit", 0, null);
      await bridge.flushChatLogs();
    });
  });

  it("executes /new and /stop locally without spawning slash prompts", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_local";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      await bridge.createSession(work, "hello", undefined, "s_1", "claude");
      bridge.getSession(work, "s_1")!.browserSockets.add(fakeBrowserSocket([]));
      const initialProc = spawnCalls[0].proc;

      const created = await bridge.sendCommand(work, "new", "", "s_1");
      expect(created).toMatchObject({
        status: "ok",
        data: { session: { id: "s_2" } },
      });
      expect(spawnCalls).toHaveLength(1);

      const stopped = await bridge.sendCommand(work, "stop", "", "s_1");
      expect(stopped).toMatchObject({ status: "ok", data: { stopped: true } });
      expect(initialProc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(spawnCalls).toHaveLength(1);
      await bridge.flushChatLogs();
    });
  });

  it("rejects command execution without an active sessionId", async () => {
    await withTempDataDir(async (dir) => {
      const { WsBridge } = await import("../../../ws-bridge.js");
      const work = "w_no_sid";
      await mkdir(join(dir, "works", work), { recursive: true });
      const bridge = new WsBridge(3271);
      const result = await bridge.sendCommand(work, "new", "", "");
      expect(result).toMatchObject({ status: "error", errorCode: "session_required" });
      expect(spawnCalls).toHaveLength(0);
    });
  });
});
