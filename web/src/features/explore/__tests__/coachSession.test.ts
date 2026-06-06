/**
 * coachSession — the workless grounded-coach wiring for the 灵感/Explore page
 * (PRD-0006 S7). The coach is NOT a work: it streams over the shared chat WS
 * channel (/ws/browser/coach_main) for tokens + history reseed, but its SEND
 * path goes through POST /api/coach/message (so the first turn spins up the
 * grounded research session) and its model switch goes through the
 * SESSION-scoped POST /api/coach/model (not the global /api/agent/model that
 * would steal the editing agent's tier).
 *
 * These pure helpers carry that decoupling so the UI shell stays dumb. We test
 * the external contract: which endpoint each call hits + with what body.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ sent: true }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("COACH_SESSION_KEY", () => {
  it("is the stable workless key the backend routes coach turns under", async () => {
    const { COACH_SESSION_KEY } = await import("../coachSession");
    // Must match the backend coachKeyFor("main") = "coach_main" so the WS path
    // /ws/browser/coach_main reseeds the same persisted session.
    expect(COACH_SESSION_KEY).toBe("coach_main");
    expect(COACH_SESSION_KEY.startsWith("coach_")).toBe(true);
    // NOT a work id and NOT the ephemeral trends_ kind.
    expect(COACH_SESSION_KEY.startsWith("trends_")).toBe(false);
  });
});

describe("sendCoachMessage", () => {
  it("POSTs the message to /api/coach/message (NOT a work chat endpoint)", async () => {
    const { sendCoachMessage } = await import("../coachSession");
    await sendCoachMessage("下一个该做什么选题", "douyin");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/coach/message");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("下一个该做什么选题");
    expect(body.platform).toBe("douyin");
    // never a per-work chat endpoint — the coach is workless
    expect(String(url)).not.toContain("/api/works/");
  });

  it("defaults the platform to douyin when none is given (the user's real platform)", async () => {
    const { sendCoachMessage } = await import("../coachSession");
    await sendCoachMessage("hi");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.platform).toBe("douyin");
  });
});

describe("setCoachModel", () => {
  it("switches the coach tier via the SESSION-scoped /api/coach/model (NOT global /api/agent/model)", async () => {
    const { setCoachModel } = await import("../coachSession");
    await setCoachModel("haiku");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/coach/model");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("haiku");
    // crucial honesty/isolation contract: the coach must NOT touch the editing
    // agent's global model tier.
    expect(String(url)).not.toBe("/api/agent/model");
    expect(String(url)).not.toContain("/api/agent/model");
    // and it carries NO workId (workless)
    expect(body.workId).toBeUndefined();
  });
});

describe("COACH_PROMPT_LIBRARY", () => {
  it("seeds starter questions grounded in the user's works/trends/interests", async () => {
    const { COACH_PROMPT_LIBRARY } = await import("../coachSession");
    expect(COACH_PROMPT_LIBRARY.length).toBeGreaterThanOrEqual(3);
    // each entry pairs a short i18n label key with the longer i18n prompt key —
    // both under the explore.coach.* namespace so they localize.
    for (const entry of COACH_PROMPT_LIBRARY) {
      expect(entry.labelKey).toMatch(/^explore\.coach\./);
      expect(entry.promptKey).toMatch(/^explore\.coach\./);
      expect(entry.labelKey).not.toBe(entry.promptKey);
    }
  });
});
