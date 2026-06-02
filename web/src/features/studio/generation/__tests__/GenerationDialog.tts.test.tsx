// #3 — dual-provider TTS frontend: voice catalog parity + direct dispatch to
// the work-scoped /api/works/:id/tts endpoint (mirrors the video provider
// path). See GenerationDialog.tsx shouldDispatchTts / dispatchTtsGenerate.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GenerationDialog } from "../GenerationDialog";

// useChatSocket must NOT be called for TTS anymore — mock it so we can also
// assert it stays untouched.
const sendMock = vi.fn();
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: sendMock }),
}));

// apiFetch reads res.headers.get("content-type"). Shared headers helper.
const jsonHeaders = () => new Headers({ "content-type": "application/json" });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  sendMock.mockClear();
});

// Each test vi.stubGlobal("fetch", ...) — restore so a stub can't bleed into
// sibling tests sharing the worker (vitest unstubGlobals defaults false).
afterEach(() => {
  vi.unstubAllGlobals();
});

// Navigate the dialog to the audio → tts sub-tab and type a script.
async function openTtsAndType(script: string) {
  fireEvent.click(screen.getByRole("button", { name: /^audio$/i }));
  // audio defaults to the BGM sub-tab; switch to TTS.
  fireEvent.click(screen.getByRole("button", { name: /^tts$/i }));
  const prompt = (await screen.findByPlaceholderText(
    /欢迎来到 AutoViral/i,
  )) as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: script } });
}

describe("GenerationDialog TTS voice catalog (zh+en parity)", () => {
  it("includes both a zh-CN-* and an en-US-* voice value", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: jsonHeaders(),
      json: async () => ({ providers: [] }),
      text: async () => "",
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^audio$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^tts$/i }));

    const voiceSelect = (await screen.findByLabelText(
      /voice|音色/i,
    )) as HTMLSelectElement;
    const values = Array.from(voiceSelect.options).map((o) => o.value);
    expect(values.some((v) => /^zh-CN-/.test(v))).toBe(true);
    expect(values.some((v) => /^en-US-/.test(v))).toBe(true);
  });
});

describe("GenerationDialog TTS direct dispatch", () => {
  function ttsFetchMock(ok = true) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/tts") && init?.method === "POST") {
        if (!ok) {
          return {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            headers: jsonHeaders(),
            json: async () => ({
              error: "all providers failed",
              errorCode: "tts_provider_error",
            }),
            text: async () => "all providers failed",
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({
            ok: true,
            relativeUri: "assets/audio/tts_abc123def456.mp3",
            providerId: "edge-tts",
            durationSec: 2.4,
            voice: "zh-CN-XiaoxiaoNeural",
          }),
          text: async () => "",
        } as unknown as Response;
      }
      // providers + everything else
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

  it("POSTs to /api/works/:id/tts with text + voice, then invalidates assets and closes on 200", async () => {
    const fetchMock = ttsFetchMock(true);
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <GenerationDialog
          workId="w1"
          open={true}
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    );

    await openTtsAndType("你好，欢迎来到 AutoViral 的旁白测试");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/api/works/w1/tts") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeDefined();
    });

    const call = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/works/w1/tts") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    )!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.text).toBe("你好，欢迎来到 AutoViral 的旁白测试");
    expect(typeof body.voice).toBe("string");
    expect(body.voice.length).toBeGreaterThan(0);

    // assets query invalidated → AssetSidebar refetches.
    await waitFor(() => {
      const match = invalidateSpy.mock.calls.find((c) => {
        const arg = c[0] as { queryKey?: unknown } | undefined;
        return (
          Array.isArray(arg?.queryKey) &&
          (arg!.queryKey as unknown[])[0] === "assets" &&
          (arg!.queryKey as unknown[])[1] === "w1"
        );
      });
      expect(match).toBeDefined();
    });

    // dialog closes on success.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // No chat notification for TTS.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows an error on a 500 response", async () => {
    const fetchMock = ttsFetchMock(false);
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={onOpenChange} />,
    );

    await openTtsAndType("失败路径测试，服务返回 500");
    fireEvent.click(screen.getByRole("button", { name: /^generate|生成$/i }));

    // Error alert surfaces and the dialog stays open (no close call).
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/500|failed|失败/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
