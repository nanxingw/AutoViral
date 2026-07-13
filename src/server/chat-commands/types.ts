import type { ChatBackendId } from "../chat-backends/registry.js";
import type { ChatProviderCapabilities } from "../chat-backends/types.js";

export type ChatCommandKind = "local" | "translate" | "passthrough";
export type ChatCommandDenyPolicy = "allow" | "safe_dynamic_only";

export interface ChatCommandArgs {
  required: boolean;
  placeholder?: string;
}

export interface ChatCommandAvailability {
  available: boolean;
  reasonCode?:
    | "capabilities_unknown"
    | "history_required"
    | "session_disconnected"
    | "session_required"
    | "session_idle"
    | "unsupported_by_backend";
  reason?: string;
}

export interface ChatCommandEntry {
  name: string;
  backend: ChatBackendId;
  kind: ChatCommandKind;
  args: ChatCommandArgs;
  availability: ChatCommandAvailability;
  description: string;
  denyPolicy: ChatCommandDenyPolicy;
}

export interface ChatCommandSessionState {
  exists: boolean;
  connected: boolean;
  idle: boolean;
  hasHistory: boolean;
}

export interface ChatCommandCatalogInput {
  backend: ChatBackendId;
  session: ChatCommandSessionState;
  capabilities: ChatProviderCapabilities;
}

export interface ChatCommandResolveInput extends ChatCommandCatalogInput {
  name: string;
  args: string;
}

export type ChatCommandResolution =
  | {
      status: "ready";
      command: ChatCommandEntry;
      prompt?: string;
    }
  | {
      status: "unsupported";
      errorCode: "unsupported_command";
      command: string;
      message: string;
    };

export interface ChatCommandCatalog {
  sessionId: string;
  backend: ChatBackendId;
  commands: ChatCommandEntry[];
}

export interface ChatCommandExecutionResult {
  status: "ok" | "unsupported" | "error";
  command: string;
  errorCode?: string;
  message?: string;
  data?: Record<string, unknown>;
  deduped?: boolean;
}
