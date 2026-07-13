import type { ChatCommandExecutionResult } from "./types.js";

export interface LocalChatCommandContext {
  workId: string;
  sessionId: string;
  backend: string;
  setSessionModel(model: string): boolean;
  createSession(backend: string): Promise<{ id: string } | null>;
  killSession(): boolean;
}

export async function executeLocalChatCommand(
  name: string,
  args: string,
  context: LocalChatCommandContext,
): Promise<ChatCommandExecutionResult> {
  if (name === "model") {
    const model = args.trim();
    if (!model || model.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
      return {
        status: "error",
        command: name,
        errorCode: "invalid_command_args",
        message: "Model must be a non-empty model alias.",
      };
    }
    if (!context.setSessionModel(model)) {
      return { status: "error", command: name, errorCode: "session_not_found" };
    }
    return { status: "ok", command: name, data: { model } };
  }

  if (name === "new") {
    const session = await context.createSession(context.backend);
    if (!session) return { status: "error", command: name, errorCode: "session_create_failed" };
    return { status: "ok", command: name, data: { session } };
  }

  if (name === "stop") {
    const stopped = context.killSession();
    return stopped
      ? { status: "ok", command: name, data: { stopped: true } }
      : { status: "error", command: name, errorCode: "session_not_found" };
  }

  return { status: "unsupported", command: name, errorCode: "unsupported_command" };
}
