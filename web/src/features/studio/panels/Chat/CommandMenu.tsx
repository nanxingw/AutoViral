import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type Ref,
} from "react";
import type {
  ChatCommandCatalog,
  ChatCommandEntry,
} from "@/features/chat/types";
import { useT, type MessageKey } from "@/i18n/useT";

export type { ChatCommandCatalog } from "@/features/chat/types";

type TextareaProps = Omit<
  ComponentProps<"textarea">,
  "value" | "ref" | "aria-controls" | "aria-expanded"
>;

export interface CommandMenuProps {
  value: string;
  catalog: ChatCommandCatalog | null;
  onValueChange: (value: string) => void;
  onRun: (name: string, args: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaProps?: TextareaProps;
}

const REASON_KEYS: Record<string, MessageKey> = {
  history_required: "chatCommands.availability.historyRequired",
  session_disconnected: "chatCommands.availability.disconnected",
  session_required: "chatCommands.availability.sessionRequired",
  session_idle: "chatCommands.availability.sessionIdle",
  unsupported_by_backend: "chatCommands.availability.unsupportedBackend",
  capabilities_unknown: "chatCommands.availability.capabilitiesUnknown",
};

function commandDescription(command: ChatCommandEntry, t: ReturnType<typeof useT>) {
  const known = `chatCommands.description.${command.name}` as MessageKey;
  if (["model", "new", "stop", "compact"].includes(command.name)) return t(known);
  return t("chatCommands.description.skill", { name: command.name });
}

function unavailableReason(command: ChatCommandEntry, t: ReturnType<typeof useT>) {
  const key = command.availability.reasonCode
    ? REASON_KEYS[command.availability.reasonCode]
    : undefined;
  return key ? t(key) : t("chatCommands.availability.unavailable");
}

function parseCommand(value: string) {
  const match = value.match(/^\/([^\s]*)(?:\s+(.*))?$/s);
  return match
    ? { query: match[1].toLowerCase(), args: (match[2] ?? "").trim() }
    : null;
}

export function CommandMenu({
  value,
  catalog,
  onValueChange,
  onRun,
  textareaRef,
  textareaProps,
}: CommandMenuProps) {
  const t = useT();
  const reactId = useId().replace(/:/g, "");
  const listboxId = `chat-command-list-${reactId}`;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const parsed = parseCommand(value);
  const filtered = useMemo(() => {
    if (!parsed) return [];
    return (catalog?.commands ?? []).filter((command) =>
      command.name.toLowerCase().startsWith(parsed.query),
    );
  }, [catalog, parsed?.query]);
  const open = parsed !== null && dismissedValue !== value && filtered.length > 0;
  const selectedIndex = filtered.length ? Math.min(activeIndex, filtered.length - 1) : 0;
  const activeOption = open ? filtered[selectedIndex] : undefined;
  const activeOptionId = activeOption
    ? `${listboxId}-option-${activeOption.name}`
    : undefined;

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const run = (command: ChatCommandEntry) => {
    if (!command.availability.available || !parsed) return;
    onRun(command.name, parsed.args);
    setDismissedValue(value);
  };

  const complete = (command: ChatCommandEntry) => {
    if (!command.availability.available) return;
    const next = `/${command.name}${command.args.required ? " " : ""}`;
    onValueChange(next);
    setDismissedValue(next);
  };

  const {
    onKeyDown: callerKeyDown,
    onChange: callerChange,
    style,
    ...restTextareaProps
  } = textareaProps ?? {};

  return (
    <div style={{ position: "relative" }}>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("chatCommands.menuLabel")}
          style={{
            position: "absolute",
            zIndex: 40,
            left: 0,
            right: 0,
            bottom: "calc(100% + 8px)",
            maxHeight: 240,
            overflowY: "auto",
            padding: 6,
            border: "1px solid var(--glass-border)",
            borderRadius: 10,
            background: "var(--surface-1)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
          }}
        >
          {filtered.map((command, index) => {
            const selected = index === selectedIndex;
            return (
              <div
                key={`${catalog?.sessionId ?? "session"}-${command.name}`}
                id={`${listboxId}-option-${command.name}`}
                role="option"
                aria-selected={selected}
                aria-disabled={!command.availability.available}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(command)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "2px 10px",
                  padding: "7px 9px",
                  borderRadius: 7,
                  cursor: command.availability.available ? "pointer" : "not-allowed",
                  opacity: command.availability.available ? 1 : 0.62,
                  background: selected ? "var(--accent-glow)" : "transparent",
                }}
              >
                <span style={{ gridRow: "1 / span 2", fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: 12 }}>
                  /{command.name}
                </span>
                <span style={{ color: "var(--text-soft)", fontSize: 11 }}>
                  {commandDescription(command, t)}
                </span>
                {!command.availability.available ? (
                  <span style={{ color: "var(--status-warn, #d0a54f)", fontSize: 10 }}>
                    {unavailableReason(command, t)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <textarea
        {...restTextareaProps}
        ref={textareaRef}
        value={value}
        role="textbox"
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-activedescendant={activeOptionId}
        style={{ width: "100%", ...style }}
        onChange={(event) => {
          setDismissedValue(null);
          onValueChange(event.target.value);
          callerChange?.(event);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (open && event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((selectedIndex + 1) % filtered.length);
            return;
          }
          if (open && event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((selectedIndex - 1 + filtered.length) % filtered.length);
            return;
          }
          if (open && event.key === "Tab" && activeOption) {
            event.preventDefault();
            complete(activeOption);
            return;
          }
          if (open && event.key === "Enter" && activeOption) {
            event.preventDefault();
            run(activeOption);
            return;
          }
          if (open && event.key === "Escape") {
            event.preventDefault();
            setDismissedValue(value);
            return;
          }
          callerKeyDown?.(event);
        }}
      />
    </div>
  );
}
