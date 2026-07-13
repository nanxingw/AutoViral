import { create } from "zustand";
import type {
  StreamBlock,
  StreamBlockType,
  TurnUsage,
  ChatAttachment,
  ChatCommandStatus,
} from "./types";

interface CommandBlockUpdate {
  name: string;
  args?: string;
  status: ChatCommandStatus;
  result?: string;
}

interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { id?: string; type: StreamBlockType; text: string; toolName?: string; questions?: string[]; attachments?: ChatAttachment[] }) => void;
  /** Start or settle the newest matching command block. A result frame updates
   * its command_started block instead of creating a normal chat bubble. */
  upsertCommand: (command: CommandBlockUpdate) => void;
  /** Replace the whole conversation — used when seeding from a server history
   *  path (HTTP /chat or WS message_history). Dedups by id defensively. */
  setBlocks: (blocks: StreamBlock[]) => void;
  setStreaming: (s: boolean) => void;
  /** Attach Claude CLI's per-turn cost/duration/usage to the last assistant
   *  text block. Called by useChatSocket on `turn_complete`. */
  attachLastTurnUsage: (usage: TurnUsage) => void;
  clear: () => void;
}

let counter = 0;
const nextId = () => `b_${Date.now()}_${counter++}`;

/** A `b_…` id is client-synthesized (an optimistic echo that hasn't learned its
 *  server id yet); a null id is a legacy/old-server block. Both are "not yet a
 *  server id" and so are eligible to ADOPT a stable server id when the same
 *  block re-arrives on a seed path. Server ids are `{sessionId}:{seq}` /
 *  `hist_{i}` and never start with `b_`. */
const isClientLocalId = (id?: string): boolean => id == null || id.startsWith("b_");

/** A1 (PRD-0010) — collapse blocks that share an id, keeping first-seen order.
 *  Guards a history seed against an already-doubled legacy log AND against a
 *  live block the seed also includes. Id-less blocks (legacy / optimistic echo)
 *  are kept as-is — their positional identity is all we have. */
function dedupeById(blocks: StreamBlock[]): StreamBlock[] {
  const seen = new Set<string>();
  const out: StreamBlock[] = [];
  for (const b of blocks) {
    if (b.id != null) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
    }
    out.push(b);
  }
  return out;
}

export const useChatStore = create<ChatStore>((set) => ({
  blocks: [],
  streaming: false,
  push: (b) =>
    set((s) => {
      // A1 (PRD-0010) — server-assigned blocks carry a stable id, so dedup BY ID:
      // the same logical block re-arriving on any seed path (live re-broadcast,
      // reconnect, StrictMode double-mount, a CLI re-emit after a tool cycle)
      // upserts in place instead of stacking a second bubble. Unlike the old
      // last-block-only heuristic this survives NON-contiguous re-arrivals (a
      // tool_result in between used to defeat it), and it never wrongly collapses
      // a legit repeat (two identical tool runs get different seqs → different ids).
      if (b.id != null) {
        if (s.blocks.some((x) => x.id === b.id)) return s; // already present → no-op
        // A1 review — ADOPT an optimistic echo: the coach path (recordUserMessage
        // → broadcastToSession `block`) re-broadcasts the recorded user block WITH
        // its stable id back to the SAME tab that already rendered a client-local
        // (`b_…`) echo from send(). Without adoption the id branch appended a
        // SECOND identical bubble — the very "message doubling" A1 targets. Fold
        // the server id onto the first client-local block that matches this one on
        // type/text/toolName (fields are equal by construction, so only the id
        // changes — ts/attachments are preserved).
        const echoIdx = s.blocks.findIndex(
          (x) =>
            isClientLocalId(x.id) &&
            x.type === b.type &&
            x.text === b.text &&
            (x.toolName ?? null) === (b.toolName ?? null),
        );
        if (echoIdx !== -1) {
          const blocks = s.blocks.slice();
          blocks[echoIdx] = { ...blocks[echoIdx], id: b.id };
          return { blocks };
        }
        return { blocks: [...s.blocks, { ts: Date.now(), ...b, id: b.id }] };
      }
      // No server id — old-server compat + the optimistic user echo, which can't
      // know its server id yet. Fall back to the contiguous last-block heuristic:
      // it only collapses an IMMEDIATE duplicate, so a legit non-contiguous
      // repeat is preserved.
      const last = s.blocks[s.blocks.length - 1];
      if (
        last &&
        last.type === b.type &&
        last.text === b.text &&
        (last.toolName ?? null) === (b.toolName ?? null)
      ) {
        return s;
      }
      return {
        blocks: [...s.blocks, { ts: Date.now(), ...b, id: nextId() }],
      };
    }),
  upsertCommand: (command) =>
    set((s) => {
      const args = command.args?.trim() ?? "";
      const invocation = `/${command.name}${args ? ` ${args}` : ""}`;
      if (command.status !== "running") {
        const index = s.blocks.findLastIndex(
          (block) =>
            block.type === "command" &&
            block.commandName === command.name &&
            block.commandStatus === "running",
        );
        if (index !== -1) {
          const blocks = s.blocks.slice();
          blocks[index] = {
            ...blocks[index],
            commandStatus: command.status,
            commandResult: command.result,
          };
          return { blocks };
        }
      }
      return {
        blocks: [
          ...s.blocks,
          {
            id: nextId(),
            ts: Date.now(),
            type: "command",
            text: invocation,
            commandName: command.name,
            commandArgs: args,
            commandStatus: command.status,
            commandResult: command.result,
          },
        ],
      };
    }),
  setBlocks: (blocks) => set({ blocks: dedupeById(blocks) }),
  setStreaming: (streaming) => set({ streaming }),
  attachLastTurnUsage: (usage) =>
    set((s) => {
      // Walk back from the end to find the most recent assistant text block.
      // Anything past it (e.g. an unterminated thinking) shouldn't grow
      // a cost badge — only one bubble per turn carries it.
      const blocks = s.blocks.slice();
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === "text") {
          blocks[i] = { ...blocks[i], usage };
          return { blocks };
        }
      }
      return s;
    }),
  clear: () => set({ blocks: [] }),
}));
