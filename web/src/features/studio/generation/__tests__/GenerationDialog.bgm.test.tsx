// D2 (PRD-0009) — BGM dispatch error path. When Lyria intermittently returns
// empty audio, the server retries once and, if still empty, responds 502 with a
// readable `error` message ("上游模型临时返空，请稍后重试…"). The dialog must show
// THAT server message verbatim (it's already operator-actionable Chinese), not
// the generic "生成服务调度失败" fallback. A response without a usable `error`
// field still falls back to the i18n string.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GenerationDialog } from "../GenerationDialog";

const jsonHeaders = () => new Headers({ "content-type": "application/json" });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Navigate to audio → bgm (the default audio sub-tab) and type a prompt.
async function openBgmAndType(prompt: string) {
  fireEvent.click(screen.getByRole("button", { name: /^audio$/i }));
  // audio defaults to BGM; the placeholder is the ambient-pad hint.
  const textarea = (await screen.findByPlaceholderText(
    /ambient pad|ambient/i,
  )) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: prompt } });
}

/** A fetch mock whose /api/generate/bgm POST returns the given status + body. */
function bgmFetchMock(
  bgmResponse: { status: number; body: Record<string, unknown> | null; text?: string },
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/generate/bgm") && init?.method === "POST") {
      return {
        ok: bgmResponse.status >= 200 && bgmResponse.status < 300,
        status: bgmResponse.status,
        statusText: "Error",
        headers: jsonHeaders(),
        json: async () => bgmResponse.body ?? {},
        text: async () =>
          bgmResponse.text ??
          (bgmResponse.body ? JSON.stringify(bgmResponse.body) : ""),
      } as unknown as Response;
    }
    if (u.includes("/api/providers")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: jsonHeaders(),
        json: async () => ({ providers: [] }),
        text: async () => "",
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: jsonHeaders(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
  });
}

describe("GenerationDialog BGM error surfacing (D2)", () => {
  it("shows the server's readable 502 message verbatim, keeps the dialog open", async () => {
    const serverMsg = "上游模型临时返空，请稍后重试（音频流为空，已自动重试一次仍未成功）";
    const fetchMock = bgmFetchMock({
      status: 502,
      body: { success: false, error: serverMsg, code: "UPSTREAM_EMPTY_AUDIO" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={onOpenChange} />,
    );

    await openBgmAndType("warm cinematic ambient pad, sparse");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    // The server's actionable message reaches the user's eyes — not the generic
    // "生成服务调度失败" fallback.
    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(alert.textContent ?? "").toContain("请稍后重试");
    });
    expect(alert.textContent ?? "").not.toContain("生成服务调度失败");
    // Dialog stays open so the user can retry.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("falls back to the generic i18n message when the body has no usable error field", async () => {
    const fetchMock = bgmFetchMock({ status: 500, body: {}, text: "" });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={onOpenChange} />,
    );

    await openBgmAndType("warm cinematic ambient pad, sparse");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    // No usable server message → the i18n generic fallback (zh "生成服务调度失败"
    // / en "Generation provider dispatch failed", depending on locale) is shown.
    // The exact technical (English raw) text never reaches the user.
    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      const txt = alert.textContent ?? "";
      expect(txt).toMatch(/生成服务调度失败|Generation provider dispatch failed/);
      expect(txt).not.toContain("bgm dispatch failed");
    });
  });

  // D2-fixup (MEDIUM) — the server's 503/400/500 bodies carry RAW ENGLISH
  // `error` strings (code NO_API_KEY / INVALID_PARAMS / API_ERROR). Surfacing
  // those verbatim leaked English + machine detail into the user's panel (a
  // localization regression). They must instead fall back to the localized
  // generic message; only the user-facing UPSTREAM_EMPTY_AUDIO code is shown
  // verbatim. This case is the one the previous net missed.
  it("503 NO_API_KEY (English error) → localized fallback, never the English original", async () => {
    const fetchMock = bgmFetchMock({
      status: 503,
      body: {
        success: false,
        error: "openrouter.apiKey not configured",
        code: "NO_API_KEY",
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={onOpenChange} />,
    );

    await openBgmAndType("warm cinematic ambient pad, sparse");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      const txt = alert.textContent ?? "";
      // Localized generic message, NOT the raw English server string.
      expect(txt).toMatch(/生成服务调度失败|Generation provider dispatch failed/);
    });
    expect(alert.textContent ?? "").not.toContain(
      "openrouter.apiKey not configured",
    );
  });

  it("400 INVALID_PARAMS (English + value interpolation) → no English / no got-value leak", async () => {
    const fetchMock = bgmFetchMock({
      status: 400,
      body: {
        success: false,
        error:
          "durationSeconds must be a number in 5-180 (got 9999). Lyria emits a full ~2min track; this only trims it.",
        code: "INVALID_PARAMS",
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={onOpenChange} />,
    );

    await openBgmAndType("warm cinematic ambient pad, sparse");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      const txt = alert.textContent ?? "";
      expect(txt).toMatch(/生成服务调度失败|Generation provider dispatch failed/);
    });
    const txt = alert.textContent ?? "";
    expect(txt).not.toContain("durationSeconds");
    expect(txt).not.toContain("got 9999");
  });
});
