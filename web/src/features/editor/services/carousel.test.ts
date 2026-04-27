import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { loadCarousel, saveCarousel } from "./carousel";
import { makeEmptyCarousel } from "../types";
import { mswServer } from "@/test/msw";

describe("carousel service", () => {
  it("loadCarousel returns null on 404", async () => {
    mswServer.use(
      http.get("/api/works/w1/carousel", () =>
        HttpResponse.json({ error: "missing" }, { status: 404 }),
      ),
    );
    const got = await loadCarousel("w1");
    expect(got).toBeNull();
  });

  it("loadCarousel parses a valid payload", async () => {
    const car = makeEmptyCarousel("w1");
    mswServer.use(
      http.get("/api/works/w1/carousel", () => HttpResponse.json(car)),
    );
    const got = await loadCarousel("w1");
    expect(got?.workId).toBe("w1");
  });

  it("saveCarousel issues a PUT", async () => {
    let received: unknown = null;
    mswServer.use(
      http.put("/api/works/w1/carousel", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const car = makeEmptyCarousel("w1");
    await saveCarousel("w1", car);
    expect((received as { workId: string })?.workId).toBe("w1");
  });
});
