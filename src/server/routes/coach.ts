// Coach domain sub-router (PRD-0006 S6) — the persisted research/strategy coach.
//
// The 灵感/Explore page hangs one PERSISTED coach session (sidecar-backed,
// history survives reload — unlike the ephemeral `trends_` research session).
// The coach is workless: it lives under a single stable key `coach_main` and
// streams over the normal browser WS channel (/ws/browser/coach_main).
//
// Two surfaces:
//   POST /api/coach/message  — create-or-resume the coach + send a message.
//   POST /api/coach/model    — SESSION-scoped model switch (fixes the old
//                              ModelSwitcher that wrote the GLOBAL config.model
//                              and so stole the editing agent's tier).

import { Hono } from "hono";
import { getWsBridge } from "./_shared.js";
import { coachKeyFor, isCoachKey } from "../../domain/coach-session.js";

export const coachRouter = new Hono();

/** The single canonical coach session key for the inspiration page. */
const COACH_KEY = coachKeyFor("main");

const COACH_MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;

// POST /api/coach/message — send a message to the persisted coach. On the first
// turn it spins up the grounded coach session (works + selected-platform trends
// + interests); subsequent turns --resume the same persisted session.
coachRouter.post("/api/coach/message", async (c) => {
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; platform?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    const platform = typeof body.platform === "string" && body.platform ? body.platform : "douyin";

    const existing = wsBridge.getSession(COACH_KEY);
    if (!existing || existing.cliSessionId == null) {
      // First turn (or never spawned) — build the grounded coach session.
      await wsBridge.createCoachSession(COACH_KEY, text, { platform });
      // Echo the user's opening line into the persisted history (createCoachSession
      // sends the prompt to the CLI but does not push a user block).
      wsBridge.recordUserMessage(COACH_KEY, text);
      return c.json({ sent: true, sessionCreated: true, coachKey: COACH_KEY });
    }

    const sent = await wsBridge.sendMessage(COACH_KEY, text);
    if (!sent) return c.json({ error: "Failed to send message" }, 500);
    return c.json({ sent: true, coachKey: COACH_KEY });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Coach error" }, 500);
  }
});

// POST /api/coach/model — switch the coach's model tier, SESSION-scoped. Unlike
// /api/agent/model this does NOT mutate the global config.model, so the editing
// agent's tier is untouched (the bug S6 fixes). Persists the short alias only;
// the CLI resolves it to the latest member of that family at spawn.
coachRouter.post("/api/coach/model", async (c) => {
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  const body = await c.req.json().catch(() => null);
  const model = body && typeof body.model === "string" ? body.model : "";
  if (!(COACH_MODEL_ALIASES as readonly string[]).includes(model)) {
    return c.json(
      { error: "Invalid model alias", errorCode: "invalid_model_alias", allowed: COACH_MODEL_ALIASES },
      400,
    );
  }
  // Scope the switch to the coach session only; respawns on its next turn.
  const applied = isCoachKey(COACH_KEY) && wsBridge.setSessionModel(COACH_KEY, model);
  return c.json({ ok: true, model, applied });
});
