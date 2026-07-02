// A7 (PRD-0010) — useAssetText: fetch a text asset's body for in-library
// preview. Library cards read a short snippet (SNIPPET_MAX_CHARS); the preview
// modal reads (effectively) the whole document. Any network / non-2xx failure
// must resolve to { text: null, failed: true } so callers degrade gracefully.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAssetText, SNIPPET_MAX_CHARS } from "./useAssetText";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchText(body: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      text: async () => body,
    })),
  );
}

describe("useAssetText", () => {
  it("truncates to maxChars and flags truncated", async () => {
    const long = "x".repeat(SNIPPET_MAX_CHARS + 50);
    stubFetchText(long);
    const { result } = renderHook(() => useAssetText("/api/works/w1/assets/a.md"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toHaveLength(SNIPPET_MAX_CHARS);
    expect(result.current.truncated).toBe(true);
    expect(result.current.failed).toBe(false);
  });

  it("returns the full body when under the cap", async () => {
    stubFetchText("short body");
    const { result } = renderHook(() =>
      useAssetText("/api/works/w1/assets/a.md", 1000),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toBe("short body");
    expect(result.current.truncated).toBe(false);
  });

  it("degrades to failed on a non-2xx response", async () => {
    stubFetchText("nope", false, 404);
    const { result } = renderHook(() => useAssetText("/api/works/w1/assets/a.md"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toBeNull();
    expect(result.current.failed).toBe(true);
  });

  it("degrades to failed when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const { result } = renderHook(() => useAssetText("/api/works/w1/assets/a.md"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(true);
    expect(result.current.text).toBeNull();
  });

  it("does not fetch when url is null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAssetText(null));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
