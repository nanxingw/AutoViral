export type StreamBlockType =
  | "user"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ask_question";

export interface StreamBlock {
  id: string;
  type: StreamBlockType;
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: string[];
  ts: number;
}
