import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const handlers = [
  http.get("/api/works", () =>
    HttpResponse.json([
      { id: "w1", title: "Hook Formula", type: "image-text", status: "published", thumbnail: null, updatedAt: "2026-04-22T10:00:00Z" },
      { id: "w2", title: "Why Nobody Watches", type: "short-video", status: "published", thumbnail: null, updatedAt: "2026-04-23T10:00:00Z" },
      { id: "w3", title: "Competitor Blind Spots", type: "short-video", status: "draft", thumbnail: null, updatedAt: "2026-04-24T10:00:00Z" },
    ]),
  ),
  http.post("/api/works", async ({ request }) => {
    const body = (await request.json()) as { title?: string; type?: string };
    return HttpResponse.json({ id: "w-new", title: body.title ?? "Untitled", type: body.type ?? "short-video", status: "draft", updatedAt: "2026-04-25T00:00:00Z" });
  }),
];

export const mswServer = setupServer(...handlers);
