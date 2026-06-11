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

  it("omits aspectRatio when a stale image-tab value (4:5) is carried into the video dispatch", async () => {
    // 4:5 is in IMAGE_ASPECTS but NOT in VIDEO_ASPECTS / the seedance enum.
    // Switching image→video keeps form.aspectRatio, and the video <select>
    // can't display 4:5 — so the dispatch must drop it (the server then
    // canvas-follows) rather than forward an off-enum value to the gateway.
    const fetchMock = dispatchFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);

    // On the IMAGE tab (default), pick the video-illegal 4:5 aspect.
    const imageAspect = screen.getByLabelText(
      /aspect ratio/i,
    ) as HTMLSelectElement;
    fireEvent.change(imageAspect, { target: { value: "4:5" } });

    // Switch to the VIDEO tab — form.aspectRatio is still 4:5 under the hood.
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
    const body = JSON.parse((dispatchCall[1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("aspectRatio");
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

// ─── Video duration contract guard ──────────────────────────────────────────
//
// Seedance 2.0's authoritative create-videos schema supports
// supported_durations = 4..15 (integer seconds; 3 does NOT exist). The provider
// /generate-video endpoint passes duration straight through, so a `3` option
// would round-trip to a silent server rejection. F155 once locked the select to
// a stale {3,5,10} note — this guard makes a future edit that reintroduces an
// out-of-range value fail loudly.

describe("GenerationDialog video duration options (Seedance contract)", () => {
  it("offers only integer durations in 4..15 — never 3", () => {
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    const durationSelect = screen.getByLabelText(
      /duration \(s\)/i,
    ) as HTMLSelectElement;
    const values = Array.from(durationSelect.options).map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("3");
    for (const v of values) {
      const n = Number(v);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(15);
    }
  });
});

// ─── B3 — death-envelope retirement: every kind×mode direct-dispatches ────────
//
// Before B3, image-create / BGM(create+variant) / image-variant / video-variant
// / tts-variant all fell through to a chat "death-envelope" that told the agent
// to run four since-deleted *.py scripts. They now POST to real endpoints:
//   image  → /api/generate/image            (create + variant)
//   bgm    → /api/generate/bgm              (create + variant)
//   tts    → /api/works/:id/tts             (create + variant)
//   video  → /api/providers/:id/generate-video (create + variant)
// These tests assert the dispatch URL + body shape (no relaxed matchers — they
// pin the exact endpoint and required fields).

describe("GenerationDialog B3 direct-dispatch wiring", () => {
  // A mock that answers every B3 endpoint with 200 + records the call.
  function b3FetchMock() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const isPost = init?.method === "POST";
      const ok200 = (json: unknown) =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: jsonHeaders(),
          json: async () => json,
          text: async () => "",
        }) as unknown as Response;
      if (u.includes("/api/generate/image") && isPost) {
        return ok200({ success: true, assetId: "img_1" });
      }
      if (u.includes("/api/generate/bgm") && isPost) {
        return ok200({ success: true, assetId: "bgm_1" });
      }
      if (u.includes("/tts") && isPost) {
        return ok200({ ok: true, relativeUri: "assets/audio/tts_x.mp3" });
      }
      if (u.includes("/generate-video") && isPost) {
        return ok200({ assetId: "vid_1", assetUri: "x.mp4", stub: true });
      }
      if (u.includes("/api/providers")) {
        return ok200({ providers: PROVIDERS });
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

  function findPost(
    fetchMock: ReturnType<typeof b3FetchMock>,
    matcher: (u: string) => boolean,
  ) {
    return fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        matcher(c[0] as string) &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
  }
  function bodyOf(call: unknown[] | undefined) {
    return JSON.parse((call![1] as RequestInit).body as string);
  }

  it("image CREATE → POST /api/generate/image with workId + prompt + a filename", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    // Image tab is the default. Fill a >=10-char prompt.
    const prompt = screen.getByPlaceholderText(
      /panda eating bamboo/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(prompt, {
      target: { value: "a serene koi pond at dusk, editorial grade" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/api/generate/image"))).toBeDefined();
    });
    const call = findPost(fetchMock, (u) => u.endsWith("/api/generate/image"));
    expect(call![0]).toBe("/api/generate/image");
    const body = bodyOf(call);
    expect(body.workId).toBe("w1");
    expect(body.prompt).toBe("a serene koi pond at dusk, editorial grade");
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    // Create mode carries no referenceImage.
    expect(body.referenceImage).toBeUndefined();
  });

  it("image VARIANT → POST /api/generate/image with referenceImage=source.uri + fused prompt", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const source = {
      id: "asset-koi-v1",
      name: "Koi v1",
      uri: "/api/works/w1/assets/images/koi-v1.png",
      sourcePrompt: "a koi pond at dusk",
      sourceModel: "openai/gpt-5.4-image-2",
      sourceAspectRatio: "1:1",
    };
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} source={source} />,
    );
    const change = screen.getByPlaceholderText(/slower droop/i) as HTMLTextAreaElement;
    fireEvent.change(change, { target: { value: "warmer color grade" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/api/generate/image"))).toBeDefined();
    });
    const body = bodyOf(findPost(fetchMock, (u) => u.includes("/api/generate/image")));
    // B3 review fix — the same-origin relative source uri is ABSOLUTIZED before
    // dispatch (openrouter-image silently drops a non-http/data referenceImage).
    expect(body.referenceImage).toBe(
      `${window.location.origin}/api/works/w1/assets/images/koi-v1.png`,
    );
    // Fused: source prompt + change direction.
    expect(body.prompt).toContain("a koi pond at dusk");
    expect(body.prompt).toContain("warmer color grade");
  });

  it("BGM CREATE → POST /api/generate/bgm with durationSeconds forwarded", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^audio$/i }));
    // BGM is the default audio sub-kind.
    const prompt = screen.getByPlaceholderText(
      /warm cinematic ambient pad/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "lofi rainy night, 70 BPM" } });
    const dur = screen.getByLabelText(/duration \(seconds\)/i) as HTMLInputElement;
    fireEvent.change(dur, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/api/generate/bgm"))).toBeDefined();
    });
    const body = bodyOf(findPost(fetchMock, (u) => u.includes("/api/generate/bgm")));
    expect(body.workId).toBe("w1");
    expect(body.prompt).toBe("lofi rainy night, 70 BPM");
    expect(body.durationSeconds).toBe(45);
    expect(typeof body.filename).toBe("string");
  });

  it("BGM duration input clamps a typed out-of-range value to <=180 (#75)", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^audio$/i }));
    fireEvent.change(
      screen.getByPlaceholderText(/warm cinematic ambient pad/i),
      { target: { value: "ambient drone" } },
    );
    const dur = screen.getByLabelText(/duration \(seconds\)/i) as HTMLInputElement;
    fireEvent.change(dur, { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/api/generate/bgm"))).toBeDefined();
    });
    const body = bodyOf(findPost(fetchMock, (u) => u.includes("/api/generate/bgm")));
    expect(body.durationSeconds).toBeLessThanOrEqual(180);
  });

  it("video VARIANT → POST /generate-video with firstFrameImage=source.uri", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const source = {
      id: "asset-panda-v1",
      name: "Panda v1",
      uri: "/api/works/w1/assets/clips/panda-v1.mp4",
      sourcePrompt: "panda drooping head",
      sourceModel: "bytedance/seedance-2.0",
      sourceAspectRatio: "9:16",
      sourceDuration: 4,
    };
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} source={source} />,
    );
    // Variant kind is locked to video (sourceDuration set, aspectRatio present).
    const select = (await screen.findByLabelText("Provider")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    const change = screen.getByPlaceholderText(/slower droop/i) as HTMLTextAreaElement;
    fireEvent.change(change, { target: { value: "slower droop" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/generate-video"))).toBeDefined();
    });
    const call = findPost(fetchMock, (u) => u.includes("/generate-video"));
    expect((call![0] as string)).toMatch(/\/api\/providers\/sora\/generate-video$/);
    const body = bodyOf(call);
    // B3 review fix — the source uri is ABSOLUTIZED before dispatch (seedance
    // hands firstFrameImage to OpenRouter's server-side fetch, which can't
    // resolve a path relative to the browser origin).
    expect(body.firstFrameImage).toBe(
      `${window.location.origin}/api/works/w1/assets/clips/panda-v1.mp4`,
    );
    expect(body.workId).toBe("w1");
    expect(body.prompt).toContain("panda drooping head");
    expect(body.prompt).toContain("slower droop");
  });

  it("tts VARIANT → POST /api/works/:id/tts with voice from source + fused text", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const source = {
      id: "asset-narration-v1",
      name: "Narration v1",
      uri: "/api/works/w1/assets/audio/n1.mp3",
      sourcePrompt: "你好，欢迎",
      sourceVoice: "zh-CN-YunjianNeural",
    };
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} source={source} />,
    );
    const change = screen.getByPlaceholderText(/slower droop/i) as HTMLTextAreaElement;
    fireEvent.change(change, { target: { value: "更热情一点" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/tts"))).toBeDefined();
    });
    const call = findPost(fetchMock, (u) => u.includes("/tts"));
    expect((call![0] as string)).toBe("/api/works/w1/tts");
    const body = bodyOf(call);
    expect(body.voice).toBe("zh-CN-YunjianNeural");
    expect(body.text).toContain("你好，欢迎");
    expect(body.text).toContain("更热情一点");
  });

  it("never POSTs to a *.py script path or sends a chat death-envelope", async () => {
    const fetchMock = b3FetchMock();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/panda eating bamboo/i),
      { target: { value: "a serene koi pond at dusk, editorial grade" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => {
      expect(findPost(fetchMock, (u) => u.includes("/api/generate/image"))).toBeDefined();
    });
    for (const c of fetchMock.mock.calls) {
      const u = String(c[0]);
      expect(u).not.toContain(".py");
      expect(u).not.toContain("openrouter_generate");
      expect(u).not.toContain("seedance_generate");
      expect(u).not.toContain("tts_generate");
      expect(u).not.toContain("music_generate");
    }
  });
});
