import { describe, it, expect, beforeEach, vi } from "vitest";
import { uploadAsset } from "./uploadAsset";
import { ApiError } from "@/lib/api";

// #91 — the upload service posts multipart FormData to the (previously orphan)
// endpoint and surfaces server errorCodes as ApiError for localization.

const jsonHeaders = {
  get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
};

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("uploadAsset (#91)", () => {
  it("POSTs FormData (file + kind-based subdir) to the work upload endpoint", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: jsonHeaders,
      json: async () => ({ success: true, path: "assets/video/a.mp4", url: "/u" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await uploadAsset("w1", file("a.mp4", "video/mp4"));
    expect(res.path).toBe("assets/video/a.mp4");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/works/w1/assets/upload");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get("file") as File).name).toBe("a.mp4");
    expect(body.get("subdir")).toBe("video"); // video/* → "video"
  });

  it("routes images and audio to their own subdirs", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => ({ success: true, path: "p", url: "u" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadAsset("w1", file("p.png", "image/png"));
    expect((fetchMock.mock.calls[0]![1] as any).body.get("subdir")).toBe("images");
    await uploadAsset("w1", file("s.mp3", "audio/mpeg"));
    expect((fetchMock.mock.calls[1]![1] as any).body.get("subdir")).toBe("audio");
  });

  it("throws ApiError carrying the server errorCode on rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: unknown[]) => ({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        headers: jsonHeaders,
        json: async () => ({ error: "too big", errorCode: "asset_too_large" }),
      })),
    );
    await expect(uploadAsset("w1", file("big.mp4", "video/mp4"))).rejects.toMatchObject({
      errorCode: "asset_too_large",
    });
    await expect(uploadAsset("w1", file("big.mp4", "video/mp4"))).rejects.toBeInstanceOf(ApiError);
  });
});
