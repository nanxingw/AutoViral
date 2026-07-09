// #027 (PRD-0012 S4) — EXPORTS group rendering: finished deliverables
// (output/final-*.mp4, output/proxy-*.mp4) get an independent group with a
// "成片/成品代理" badge + mono export timestamp, distinct from the CLIPS
// grid of source video. Mirrors the isolation pattern established by
// LibraryTab.audioDensity.test.tsx: its own module-scoped useWorkAssets
// mock, own fixture, own describe block.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryTab } from "./LibraryTab";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { AssetItem, AssetGroup } from "@/queries/assets";

const CLIP_ITEM: AssetItem = {
  path: "assets/clips/intro.mp4",
  url: "/api/works/w1/assets/clips/intro.mp4",
  kind: "video",
  ext: "mp4",
  name: "intro.mp4",
};

const FINAL_ITEM: AssetItem = {
  path: "output/final-1717000000000.mp4",
  url: "/api/works/w1/assets/output/final-1717000000000.mp4",
  kind: "video",
  ext: "mp4",
  name: "final-1717000000000.mp4",
  isExport: true,
  isProxyExport: false,
  exportedAt: 1717000000000,
};

const PROXY_ITEM: AssetItem = {
  path: "output/proxy-1717000001000.mp4",
  url: "/api/works/w1/assets/output/proxy-1717000001000.mp4",
  kind: "video",
  ext: "mp4",
  name: "proxy-1717000001000.mp4",
  isExport: true,
  isProxyExport: true,
  exportedAt: 1717000001000,
};

// Mutable so individual tests can swap the fixture the mocked hook returns.
let groups: AssetGroup[] = [];

vi.mock("@/queries/assets", async (orig) => {
  const real = await orig<typeof import("@/queries/assets")>();
  return {
    ...real,
    useWorkAssets: () => ({ data: groups, isLoading: false }),
  };
});
vi.mock("../../generation/GenerationDialog", () => ({
  GenerationDialog: () => null,
}));
vi.mock("./SearchBox", () => ({ SearchBox: () => null }));
vi.mock("../../media/useGatedMediaSrc", () => ({
  useGatedMediaSrc: () => ({ src: undefined, onSettled: () => {} }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  useComposition.setState({ selection: null });
  groups = [];
});

describe("LibraryTab — EXPORTS group (#027 / PRD-0012 S4)", () => {
  it("renders EXPORTS as its own group, independent from CLIPS", () => {
    groups = [
      { group: "EXPORTS", count: 2, items: [FINAL_ITEM, PROXY_ITEM] },
      { group: "CLIPS", count: 1, items: [CLIP_ITEM] },
    ];
    render(wrap(<LibraryTab workId="w1" />));
    // Bilingual "Exports" label (case-sensitive — NOT the raw "EXPORTS" group
    // id), the rest keep their existing raw mono ids unchanged.
    expect(screen.getByRole("button", { name: "Exports · 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLIPS · 1" })).toBeInTheDocument();
  });

  it("default-active group (first in the list) shows the export tiles with a badge and mono timestamp", () => {
    groups = [
      { group: "EXPORTS", count: 2, items: [FINAL_ITEM, PROXY_ITEM] },
      { group: "CLIPS", count: 1, items: [CLIP_ITEM] },
    ];
    const { container } = render(wrap(<LibraryTab workId="w1" />));
    const badges = container.querySelectorAll('[data-testid="export-badge"]');
    expect(badges.length).toBe(2);
    // Full deliverable vs proxy get visibly distinct badge text.
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain("Export");
    expect(badgeTexts).toContain("Proxy");

    const timestamps = container.querySelectorAll('[data-testid="export-timestamp"]');
    expect(timestamps.length).toBe(2);
    // 1717000000000 ms → 2024-05-29T16:26:40.000Z → "05/29 16:26" (UTC).
    expect(Array.from(timestamps).map((t) => t.textContent)).toContain("05/29 16:26");
  });

  it("plain CLIPS tiles never render the export badge or timestamp", () => {
    groups = [{ group: "CLIPS", count: 1, items: [CLIP_ITEM] }];
    const { container } = render(wrap(<LibraryTab workId="w1" />));
    expect(container.querySelector('[data-testid="export-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-timestamp"]')).toBeNull();
    // The ordinary ordinal index chip is still shown for non-export tiles.
    expect(screen.getByText("01")).toBeInTheDocument();
  });

  it("hides the EXPORTS tab entirely when the group is empty (no deliverables yet)", () => {
    groups = [{ group: "CLIPS", count: 1, items: [CLIP_ITEM] }];
    render(wrap(<LibraryTab workId="w1" />));
    expect(screen.queryByRole("button", { name: /Exports/i })).toBeNull();
  });
});
