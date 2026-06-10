// Tests for the inline wait-state UX and the chat-skip behavior
// (Phase 8.4 follow-up — see GenerationDialog.tsx).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GenerationDialog } from "../GenerationDialog";

// Mock useChatSocket so we can assert whether `send` was called.
const sendMock = vi.fn();
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: sendMock }),
}));

const PROVIDERS = [
  { id: "sora", displayName: "Sora", available: true, stub: false },
  { id: "kling", displayName: "Kling", available: true, stub: false },
];

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// R24: apiFetch reads res.headers.get("content-type"). Shared helper so
// every Response literal in the file includes a Headers instance.
const jsonHeaders = () => new Headers({ "content-type": "application/json" });

beforeEach(() => {
  sendMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GenerationDialog inline progress", () => {
  it("renders elapsed counter and provider name during video dispatch", async () => {
    // A pending dispatch promise we resolve manually so we can observe the
    // mid-flight progress block.
    let resolveDispatch: (() => void) | null = null;
    const dispatchPromise = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/generate-video") && init?.method === "POST") {
        await dispatchPromise;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ assetId: "x" }),
          text: async () => "",
        } as unknown as Response;
      }
      if (u.includes("/api/providers")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ providers: PROVIDERS }),
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
    vi.stubGlobal("fetch", fetchMock);

    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);

    // #92 — provider dropdown is video-only; switch before finding it.
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));

    fireEvent.change(
      screen.getByPlaceholderText(/panda lazily blinking/i),
      { target: { value: "a panda eating bamboo at golden hour" } },
    );

    // Switch to fake timers AFTER initial async settling so that React
    // effects already ran, but BEFORE we advance the elapsed counter.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    // Progress block should appear with elapsed 00:00 and provider name.
    const progress = await screen.findByTestId("generation-progress");
    expect(progress.textContent ?? "").toMatch(/Sora/);
    expect(progress.textContent ?? "").toMatch(/Elapsed 00:00/);
    expect(progress.textContent ?? "").toMatch(/70-180s/);

    // Advance time by 3 seconds, the counter should tick.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(progress.textContent ?? "").toMatch(/Elapsed 00:03/);

    // Resolve the dispatch so the test cleans up.
    resolveDispatch!();
    vi.useRealTimers();
  });
});

describe("GenerationDialog chat side-effect gating", () => {
  it("video + provider selected → dispatch fires, chat.send NOT called", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/generate-video") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ assetId: "x" }),
          text: async () => "",
        } as unknown as Response;
      }
      if (u.includes("/api/providers")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ providers: PROVIDERS }),
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
    vi.stubGlobal("fetch", fetchMock);

    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);

    // #92 — provider dropdown is video-only; switch before finding it.
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));

    fireEvent.change(
      screen.getByPlaceholderText(/panda lazily blinking/i),
      { target: { value: "a panda eating bamboo at golden hour" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      const dispatchCall = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/generate-video"),
      );
      expect(dispatchCall).toBeDefined();
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  // B3 — image kind used to fall through to the chat death-envelope
  // (chat.send). It now direct-dispatches to POST /api/generate/image; chat.send
  // must NOT fire (no agent round-trip), and no /generate-video call happens.
  it("image kind → POST /api/generate/image fires, chat.send NOT called", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/generate/image") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ success: true, assetId: "img_1" }),
          text: async () => "",
        } as unknown as Response;
      }
      if (u.includes("/api/providers")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({ providers: PROVIDERS }),
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
    vi.stubGlobal("fetch", fetchMock);

    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);

    // Default kind is image. #92 — the Provider dropdown no longer renders on
    // the image tab, so wait on the image prompt field (always present here)
    // to know the dialog is fully rendered instead.
    const prompt = (await screen.findByPlaceholderText(
      /panda eating bamboo, editorial color grade/i,
    )) as HTMLTextAreaElement;
    fireEvent.change(prompt, {
      target: { value: "a calm editorial portrait of a panda" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      const imageCall = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/api/generate/image") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(imageCall).toBeDefined();
    });
    // No death-envelope chat.send for image kind anymore.
    expect(sendMock).not.toHaveBeenCalled();
    // And definitely no /generate-video call for an image request.
    const videoCall = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/generate-video"),
    );
    expect(videoCall).toBeUndefined();
  });
});
