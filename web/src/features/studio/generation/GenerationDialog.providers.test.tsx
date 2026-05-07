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

beforeEach(() => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/providers")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ providers: PROVIDERS }),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("GenerationDialog provider dropdown (Phase 8.4)", () => {
  it("fetches /api/providers and renders dropdown options", async () => {
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />,
    );
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
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />,
    );
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("sora");
    });
  });

  it("user can change selection", async () => {
    wrap(
      <GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />,
    );
    const select = (await screen.findByLabelText(
      "Provider",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    fireEvent.change(select, { target: { value: "kling" } });
    expect(select.value).toBe("kling");
  });
});
