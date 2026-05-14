// Zod schemas for the AutoViral Bridge Protocol v1.
// See docs/superpowers/specs/2026-05-14-agentic-terminal-bridge-protocol.md
//
// These types are the contract shared between:
//   - the @autoviral/cli HTTP client (cli/autoviral/src/client.ts)
//   - the backend route handlers (src/server/bridge/routes.ts)
//   - the Studio UI subscribers (web/src/features/terminal/useBridgeEvents.ts)
//
// Phase 0 only locks the whoami response; Phase 2-3 expand the surface.

import { z } from "zod";

export const WhoAmIResponseSchema = z.object({
  workId: z.string(),
  cwd: z.string(),
  port: z.number(),
  version: z.string(),
});
export type WhoAmIResponse = z.infer<typeof WhoAmIResponseSchema>;

export const SelectTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clip"), id: z.string() }),
  z.object({ kind: z.literal("track"), id: z.string() }),
  z.object({ kind: z.literal("none") }),
]);
export const SelectRequestSchema = z.object({ target: SelectTargetSchema });
export type SelectRequest = z.infer<typeof SelectRequestSchema>;

export const SeekRequestSchema = z.object({ seconds: z.number().min(0) });
export type SeekRequest = z.infer<typeof SeekRequestSchema>;

export const ToastRequestSchema = z.object({
  message: z.string().min(1).max(280),
  kind: z.enum(["info", "success", "warn", "error"]).default("info"),
  durationMs: z.number().int().positive().max(60_000).default(3000),
});
export type ToastRequest = z.infer<typeof ToastRequestSchema>;

export const ProgressRequestSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("start"),
    label: z.string().min(1),
    steps: z.number().int().positive().optional(),
  }),
  z.object({ phase: z.literal("step"), n: z.number().int().nonnegative() }),
  z.object({ phase: z.literal("done") }),
]);
export type ProgressRequest = z.infer<typeof ProgressRequestSchema>;

export const AskRequestSchema = z.object({
  message: z.string().min(1),
  kind: z.enum(["yes-no", "ok-cancel", "input"]).default("yes-no"),
  timeoutMs: z.number().int().positive().default(30 * 60 * 1000),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

// Envelope shapes (success / failure of every bridge response)
export const BridgeOkSchema = <T extends z.ZodTypeAny>(result: T) =>
  z.object({ ok: z.literal(true), result });
export const BridgeErrSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.number().int().optional(),
});
