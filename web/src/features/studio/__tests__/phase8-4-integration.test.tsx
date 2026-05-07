// Phase 8.4 — Multi-Provider Video Coverage
// AC integration: GenerationDialog renders the provider dropdown with the
// "(stub)" suffix for stub providers fetched from /api/providers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GenerationDialog } from "../generation/GenerationDialog";

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
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
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Phase 8.4 AC integration — provider dropdown stub badge", () => {
  it("renders Runway with (stub) suffix in the dropdown", async () => {
    wrap(<GenerationDialog workId="w1" open={true} onOpenChange={() => {}} />);
    const select = (await screen.findByLabelText("Provider")) as HTMLSelectElement;
    await waitFor(() => {
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => /Runway.*\(stub\)/.test(l))).toBe(true);
    });
  });
});
