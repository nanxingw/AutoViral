import type {
  ChatCommandCatalogInput,
  ChatCommandEntry,
  ChatCommandResolveInput,
  ChatCommandResolution,
} from "./types.js";

const DENIED_PROVIDER_COMMANDS = new Set([
  "config",
  "delete",
  "doctor",
  "heapdump",
  "hooks",
  "install-github-app",
  "login",
  "logout",
  "mcp",
  "permissions",
  "plugin",
  "privacy-settings",
  "statusline",
  "terminal-setup",
  "update",
  "upgrade",
]);

export function normalizeChatCommandName(name: string): string {
  return name.replace(/^\/+/, "").trim().toLowerCase();
}

export function isDeniedChatCommandName(name: string): boolean {
  return DENIED_PROVIDER_COMMANDS.has(normalizeChatCommandName(name));
}

function localEntry(
  input: ChatCommandCatalogInput,
  name: "model" | "new" | "stop",
): ChatCommandEntry {
  const definitions = {
    model: {
      args: { required: true, placeholder: "model" },
      description: "Set the model used by this session's next agent turn.",
    },
    new: {
      args: { required: false },
      description: "Create a new AutoViral chat session.",
    },
    stop: {
      args: { required: false },
      description: "Stop the active agent turn.",
    },
  } as const;
  const requiresSession = name !== "new";
  const available =
    (!requiresSession || input.session.exists) &&
    (name !== "stop" || !input.session.idle);
  return {
    name,
    backend: input.backend,
    kind: "local",
    args: definitions[name].args,
    availability: available
      ? { available: true }
      : name === "stop" && input.session.exists
        ? { available: false, reasonCode: "session_idle", reason: "There is no active turn to stop." }
        : { available: false, reasonCode: "session_required", reason: "An active session is required." },
    description: definitions[name].description,
    denyPolicy: "allow",
  };
}

function compactEntry(input: ChatCommandCatalogInput): ChatCommandEntry {
  let availability: ChatCommandEntry["availability"];
  if (input.backend === "codex") {
    availability = {
      available: false,
      reasonCode: "unsupported_by_backend",
      reason: "Codex exec does not expose /compact.",
    };
  } else if (!input.session.connected) {
    availability = {
      available: false,
      reasonCode: "session_disconnected",
      reason: "Reconnect this chat session before running /compact.",
    };
  } else if (!input.capabilities.slashCommands.includes("compact")) {
    availability = {
      available: false,
      reasonCode: "capabilities_unknown",
      reason: "Claude has not advertised /compact for this session.",
    };
  } else if (!input.session.hasHistory) {
    availability = {
      available: false,
      reasonCode: "history_required",
      reason: "/compact requires an existing conversation.",
    };
  } else {
    availability = { available: true };
  }
  return {
    name: "compact",
    backend: input.backend,
    kind: "passthrough",
    args: { required: false },
    availability,
    description: "Compact the current Claude conversation context.",
    denyPolicy: "allow",
  };
}

function dynamicSkillEntries(input: ChatCommandCatalogInput): ChatCommandEntry[] {
  if (input.backend !== "claude") return [];
  const slash = new Set(input.capabilities.slashCommands.map(normalizeChatCommandName));
  const names = new Set(input.capabilities.skills.map(normalizeChatCommandName));
  const entries: ChatCommandEntry[] = [];
  for (const name of names) {
    if (!name || name === "compact" || isDeniedChatCommandName(name) || !slash.has(name)) continue;
    entries.push({
      name,
      backend: input.backend,
      kind: "passthrough",
      args: { required: false, placeholder: "arguments" },
      availability: !input.session.connected
        ? {
            available: false,
            reasonCode: "session_disconnected",
            reason: "Reconnect this chat session before running a provider command.",
          }
        : input.session.hasHistory
          ? { available: true }
          : {
              available: false,
              reasonCode: "history_required",
              reason: "Send a normal message before running a provider command.",
            },
      description: `Claude skill /${name}.`,
      denyPolicy: "safe_dynamic_only",
    });
  }
  return entries;
}

export function listChatCommands(input: ChatCommandCatalogInput): ChatCommandEntry[] {
  return [
    localEntry(input, "model"),
    localEntry(input, "new"),
    localEntry(input, "stop"),
    compactEntry(input),
    ...dynamicSkillEntries(input),
  ];
}

export function resolveChatCommand(input: ChatCommandResolveInput): ChatCommandResolution {
  const name = normalizeChatCommandName(input.name);
  const command = listChatCommands(input).find((entry) => entry.name === name);
  if (!command || !command.availability.available || isDeniedChatCommandName(name)) {
    return {
      status: "unsupported",
      errorCode: "unsupported_command",
      command: name,
      message: command?.availability.reason ?? `Unsupported command /${name}.`,
    };
  }
  const args = input.args.trim();
  if (command.args.required && !args) {
    return {
      status: "unsupported",
      errorCode: "unsupported_command",
      command: name,
      message: `Command /${name} requires ${command.args.placeholder ?? "arguments"}.`,
    };
  }
  if (command.kind === "local") return { status: "ready", command };
  return {
    status: "ready",
    command,
    prompt: `/${name}${args ? ` ${args}` : ""}`,
  };
}
