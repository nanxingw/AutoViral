import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { WORK_TYPE_IDS } from "@shared/content-types/registry";

// I06 / ADR-006 — mock work-type values derive from the registry ids so the
// fixtures can't drift from the real content-type union.
const [VIDEO, IMAGE_TEXT] = WORK_TYPE_IDS;

export const handlers = [
  http.get("/api/works", () =>
    HttpResponse.json({
      works: [
        { id: "w1", title: "Hook Formula", type: IMAGE_TEXT, status: "published", thumbnail: null, updatedAt: "2026-04-22T10:00:00Z" },
        { id: "w2", title: "Why Nobody Watches", type: VIDEO, status: "published", thumbnail: null, updatedAt: "2026-04-23T10:00:00Z" },
        { id: "w3", title: "Competitor Blind Spots", type: VIDEO, status: "draft", thumbnail: null, updatedAt: "2026-04-24T10:00:00Z" },
      ],
    }),
  ),
  http.post("/api/works", async ({ request }) => {
    const body = (await request.json()) as { title?: string; type?: string; platforms?: string[] };
    if (!body.title || !body.type || !body.platforms) {
      return HttpResponse.json({ error: "title, type, and platforms are required" }, { status: 400 });
    }
    return HttpResponse.json(
      { id: "w-new", title: body.title, type: body.type, status: "draft", thumbnail: null, updatedAt: "2026-04-25T00:00:00Z" },
      { status: 201 },
    );
  }),
  http.get("/api/memory/profile", () =>
    HttpResponse.json({ tags: ["High-aesthetic sports blogger", "Data-driven storytelling", "Fast-paced editing"] }),
  ),
  http.get("/api/config", () =>
    HttpResponse.json({
      // R109 F475 — server-side redaction. Plaintext secrets are NEVER
      // returned; secretMeta carries set-flag + last-4 for UI rendering.
      openrouterKey: "",
      secretMeta: {
        openrouterKey: { set: false, lastFour: "" },
      },
      model: "sonnet",
    }),
  ),
  http.get("/api/works/:id/chat-commands", ({ request }) => {
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "s_1";
    return HttpResponse.json({
      sessionId,
      backend: "claude",
      commands: [
        {
          name: "model",
          backend: "claude",
          kind: "local",
          args: { required: true, placeholder: "model" },
          availability: { available: true },
          description: "Set the model used by this session's next agent turn.",
          denyPolicy: "allow",
        },
        {
          name: "new",
          backend: "claude",
          kind: "local",
          args: { required: false },
          availability: { available: true },
          description: "Create a new AutoViral chat session.",
          denyPolicy: "allow",
        },
        {
          name: "stop",
          backend: "claude",
          kind: "local",
          args: { required: false },
          availability: { available: false, reasonCode: "session_idle", reason: "There is no active turn to stop." },
          description: "Stop the active agent turn.",
          denyPolicy: "allow",
        },
        {
          name: "compact",
          backend: "claude",
          kind: "passthrough",
          args: { required: false },
          availability: { available: false, reasonCode: "history_required", reason: "/compact requires an existing conversation." },
          description: "Compact the current Claude conversation context.",
          denyPolicy: "allow",
        },
      ],
    });
  }),
];

export const mswServer = setupServer(...handlers);
