// A6 (PRD-0010) — AUDIO-group density + compact-strip form regression.
//
// Why this file exists: the AE3 素材卡 E2E dimension ("AUDIO 紧凑横条形态 +
// ≥10 条可见密度") could not be run — the claude-in-chrome browser extension
// was not connected, so the visual acceptance criterion went UNVERIFIED
// (environment blocker, not a product defect). This converts that
// browser-only criterion into deterministic CI coverage so it no longer
// depends on a live browser being paired.
//
// The two acceptance criteria the blocked E2E targeted:
//   1. "AUDIO 组一屏可见 ≥10 条" — density. jsdom/happy-dom has no real
//      viewport layout, so we assert the MECHANISM that makes ≥10 fit: the
//      AUDIO group renders every item as a compact ~52px horizontal strip
//      (AudioAssetRow), NOT the 9:16 AssetTile grid. Compact rows × N items
//      is the deterministic proxy for on-screen density.
//   2. "紧凑横条形态" — each audio row is a 52px-tall horizontal strip laid
//      out in a flex column (not the two-up 9:16 card grid).
//
// The two audio hooks are stubbed (mirroring AudioAssetRow.test.tsx) so N
// rows render cheaply and deterministically without any peaks fetch.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryTab } from "./LibraryTab";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { AssetItem, AssetGroup } from "@/queries/assets";

// 12 audio assets → proves the compact-strip form scales past the ≥10 bar.
const AUDIO_ITEMS: AssetItem[] = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    path: `assets/audio/bed-${n}.mp3`,
    url: `/api/works/w1/assets/audio/bed-${n}.mp3`,
    kind: "audio",
    ext: "mp3",
    name: `bed-${n}.mp3`,
  } satisfies AssetItem;
});

const GROUPS: AssetGroup[] = [
  { group: "AUDIO", count: AUDIO_ITEMS.length, items: AUDIO_ITEMS },
];

vi.mock("@/queries/assets", () => ({
  useWorkAssets: () => ({ data: GROUPS, isLoading: false }),
}));
vi.mock("../../generation/GenerationDialog", () => ({
  GenerationDialog: () => null,
}));
vi.mock("./SearchBox", () => ({ SearchBox: () => null }));
vi.mock("../../media/useGatedMediaSrc", () => ({
  useGatedMediaSrc: () => ({ src: undefined, onSettled: () => {} }),
}));
// Stub the audio hooks so 12 rows render without a peaks fetch / real Audio.
vi.mock("../../hooks/useAudioAudition", () => ({
  useAudioAudition: () => ({ playing: false, toggle: () => {} }),
}));
vi.mock("../../hooks/useWaveform", () => ({
  useWaveform: () => ({
    peaks: new Float32Array([0.2, 0.6, 1.0, 0.3, 0.5]),
    sourceDuration: 12.5,
    loading: false,
    error: null,
  }),
  _resetWaveformCacheForTests: () => {},
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  useComposition.setState({ selection: null });
});

describe("LibraryTab — AUDIO group density + compact-strip form (A6 / AE3)", () => {
  it("renders every audio asset as its own compact row (≥10 density proxy)", () => {
    render(wrap(<LibraryTab workId="w1" />));
    // Each AudioAssetRow root is role=button aria-label="Preview <name>".
    // The inner play button reads "Play preview" (starts with "Play"), so the
    // ^Preview anchor selects rows only, not the transport controls.
    const rows = screen.getAllByRole("button", { name: /^Preview / });
    expect(rows.length).toBe(AUDIO_ITEMS.length);
    // The acceptance bar is ≥10 visible; the fixture clears it with margin.
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("lays audio out as 52px horizontal strips in a flex column, not the 9:16 grid", () => {
    render(wrap(<LibraryTab workId="w1" />));
    const rows = screen.getAllByRole("button", { name: /^Preview / });

    // 紧凑横条形态: every row is the compact 52px strip (the 9:16 AssetTile
    // card has no such fixed height — this assertion would be red under the
    // pre-A6 card form).
    for (const row of rows) {
      expect((row as HTMLElement).style.height).toBe("52px");
    }

    // The rows share ONE flex-column container (vertical list), not the
    // two-up `grid gridTemplateColumns: 1fr 1fr` AssetTile grid.
    const listContainer = rows[0].parentElement as HTMLElement;
    expect(listContainer.style.display).toBe("flex");
    expect(listContainer.style.flexDirection).toBe("column");
    // All rows live under that same list container.
    for (const row of rows) {
      expect(row.parentElement).toBe(listContainer);
    }
    // No 9:16 two-up grid was rendered for the audio group.
    expect(listContainer.style.gridTemplateColumns).toBe("");
  });

  it("each compact row keeps waveform + mono duration + filename", () => {
    const { container } = render(wrap(<LibraryTab workId="w1" />));
    // Waveform signature: one shared PeaksSvg per row.
    expect(container.querySelectorAll('svg[aria-label="waveform"]').length).toBe(
      AUDIO_ITEMS.length,
    );
    // Mono duration derived from sourceDuration (12.5s → 0:12), one per row.
    expect(screen.getAllByText("0:12").length).toBe(AUDIO_ITEMS.length);
    // Filenames are visible without opening the asset.
    expect(screen.getByText("bed-01.mp3")).toBeInTheDocument();
    expect(screen.getByText("bed-12.mp3")).toBeInTheDocument();
  });
});
