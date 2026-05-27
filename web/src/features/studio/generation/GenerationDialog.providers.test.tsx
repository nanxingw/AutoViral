import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GenerationDialog } from "./GenerationDialog";

// useChatSocket is a side-effect we don't care about here.
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PROVIDERS = [
  { id: "runway", displayName: "Runway", available: true, stub: true },
  { id: "sora", displayName: "Sora", available: true, stub: false },
  { id: "kling", displayName: "Kling", available: true, stub: false },
];

// R24: include `headers` field (Headers instance) — apiFetch reads
// res.headers.get("content-type") to decide json vs text parsing. Bare
// mocks without headers used to work when the code called res.json()
// directly, but apiFetch refactor surfaced the gap.
const jsonHeaders = () => new Headers({ "content-type": "application/json" });

beforeEach(() => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/providers")) {
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
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("GenerationDialog provider dropdown (Phase 8.4)", () => {
  // #92 — the provider list is video-only, so the dropdown now renders on the
  // VIDEO tab only. Switch to it before asserting on the select.
  function openVideoTab() {
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
  }

  it("fetches /api/providers and renders dropdown options (video tab)", async () => {
    openVideoTab();
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => {
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Runway.*\(stub\)/),
          expect.stringMatching(/^Sora$/),
          expect.stringMatching(/^Kling$/),
        ]),
      );
    });
  });

  it("defaults to first non-stub provider", async () => {
    openVideoTab();
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("sora");
    });
  });

  it("user can change selection", async () => {
    openVideoTab();
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    fireEvent.change(select, { target: { value: "kling" } });
    expect(select.value).toBe("kling");
  });

  // #92 regression net — the dropdown must NOT appear on the IMAGE tab (the
  // dialog's default). It was a misleading dead control there: image gen
  // ignores selectedProviderId and the list is all video models.
  it("does NOT render the provider dropdown on the IMAGE tab (#92)", async () => {
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    // Let the providers query resolve so we know absence isn't just a race.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^video$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Provider")).toBeNull();
  });

  // #92 — stub providers must be disabled so they can't be picked.
  it("disables stub providers in the dropdown (#92)", async () => {
    openVideoTab();
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    const runway = Array.from(select.options).find((o) => o.value === "runway")!;
    const sora = Array.from(select.options).find((o) => o.value === "sora")!;
    expect(runway.disabled).toBe(true); // stub
    expect(sora.disabled).toBe(false); // real
  });
});

// ─── Generate dispatch wiring (Phase 8.4 — Option A) ─────────────────────────
//
// When kind === "video" and a provider is selected, clicking Generate should
// also POST /api/providers/:id/generate-video with the right body, then
// invalidate the ["assets", workId] query so AssetSidebar refetches.

describe("GenerationDialog generate dispatch (Phase 8.4 wiring)", () => {
  function dispatchFetchMock() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/generate-video") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => ({
            assetId: "gen_abc12345",
            assetUri: "/api/works/w1/assets/runway-x.mp4",
            providerJobId: "jid",
            costUsd: 0.05,
            stub: true,
          }),
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
  }

  it("POSTs to /api/providers/:id/generate-video with prompt + durationSec + aspectRatio when video kind", async () => {
    const fetchMock = dispatchFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />,
    );
    // #92 — the provider dropdown is video-only now; switch first, then wait
    // for provider options.
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));

    // Pick 9:16 aspect ratio for the dispatch (default state carries 1:1
    // from the image tab; the field exists once VideoFields render).
    const aspectSelect = screen.getByLabelText(
      /aspect ratio/i,
    ) as HTMLSelectElement;
    fireEvent.change(aspectSelect, { target: { value: "9:16" } });

    // Fill prompt
    const prompt = screen.getByPlaceholderText(
      /panda lazily blinking/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(prompt, {
      target: { value: "a panda eating bamboo at golden hour" },
    });

    // Click Generate
    const generateBtn = screen.getByRole("button", { name: /^generate$/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      const dispatchCall = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/generate-video") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(dispatchCall).toBeDefined();
    });
    const dispatchCall = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/generate-video") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    )!;
    const url = dispatchCall[0] as string;
    expect(url).toMatch(/\/api\/providers\/sora\/generate-video$/);
    const body = JSON.parse(
      (dispatchCall[1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      workId: "w1",
      prompt: "a panda eating bamboo at golden hour",
      aspectRatio: "9:16",
    });
    expect(typeof body.durationSec).toBe("number");
  });

  it("invalidates the ['assets', workId] query after a successful 200 response", async () => {
    const fetchMock = dispatchFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0 },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    // #92 — provider dropdown is video-only; switch first.
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
      const matchingCall = invalidateSpy.mock.calls.find((c) => {
        const arg = c[0] as { queryKey?: unknown } | undefined;
        return (
          Array.isArray(arg?.queryKey) &&
          (arg!.queryKey as unknown[])[0] === "assets" &&
          (arg!.queryKey as unknown[])[1] === "w1"
        );
      });
      expect(matchingCall).toBeDefined();
    });
  });
});
