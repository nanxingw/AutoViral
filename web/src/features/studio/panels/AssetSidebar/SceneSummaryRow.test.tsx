import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SceneSummaryRow, computeVisibleMeta } from "./ScriptTab";
import type { Scene } from "@shared/composition";

// ─────────────────────────────────────────────────────────────────────────────
// A5 (PRD-0010) — the collapsed summary row's meta segment (时长/景别/意图) must
// degrade by priority when the sidebar column is narrow so the shot TITLE stays
// readable (the fields remain reachable in the expanded Inspector). happy-dom has
// no layout engine, so we test the priority CONTRACT two ways:
//   1. computeVisibleMeta(width) — the pure decision, exhaustively.
//   2. SceneSummaryRow — a component test that drives width through a mocked
//      ResizeObserver and asserts which meta children survive + that the title
//      element is still present (never collapsed to a zero-width ellipsis).
// ─────────────────────────────────────────────────────────────────────────────

const FULL_SCENE: Scene = {
  id: "s1",
  order: 0,
  title: "Open on the sunlit kitchen with steam rising from a mug",
  prompt: "Wide shot",
  memberClipIds: [],
  memberAssetIds: [],
  intent: "hook",
  narration: "It started with one cup of coffee.",
  durationSec: 4,
  shotSize: "long",
  cameraMovement: "push",
  generatedAssetIds: [],
  status: "generated",
  mdAnchor: "#scene-1",
};

function renderRow() {
  return render(
    <SceneSummaryRow
      scene={FULL_SCENE}
      expanded={false}
      onToggle={() => {}}
      statusLabel="Generated"
      statusColor="var(--accent)"
      statusFilled
      isStale={false}
      intentLabel="Hook"
      shotSizeLabel="Wide"
      thumbSrc={null}
      shotNo={1}
      isFirst
      isLast={false}
      index={0}
      onMove={() => {}}
      onRemove={() => {}}
      onOpenReader={() => {}}
    />,
  );
}

describe("computeVisibleMeta — priority degradation (pure)", () => {
  it("shows every meta field when the row is wide", () => {
    expect(computeVisibleMeta(320)).toEqual({
      duration: true,
      shot: true,
      intent: true,
    });
  });

  it("defaults to showing all when the width is unmeasured (null)", () => {
    // The SSR / pre-observer default must be 'show all' so a row that is never
    // measured (e.g. happy-dom, hidden tab) never hides information.
    expect(computeVisibleMeta(null)).toEqual({
      duration: true,
      shot: true,
      intent: true,
    });
  });

  it("drops the lowest-priority field (intent) first as the row narrows", () => {
    const v = computeVisibleMeta(240);
    expect(v.intent).toBe(false);
    expect(v.shot).toBe(true);
    expect(v.duration).toBe(true);
  });

  it("drops shot next, keeping the highest-priority duration", () => {
    const v = computeVisibleMeta(200);
    expect(v.intent).toBe(false);
    expect(v.shot).toBe(false);
    expect(v.duration).toBe(true);
  });

  it("hides the whole meta segment at the narrowest widths", () => {
    expect(computeVisibleMeta(150)).toEqual({
      duration: false,
      shot: false,
      intent: false,
    });
  });

  it("is monotone — a wider row never hides a field a narrower row showed", () => {
    const widths = [120, 150, 180, 200, 220, 240, 260, 300, 400];
    for (let i = 1; i < widths.length; i++) {
      const narrow = computeVisibleMeta(widths[i - 1]);
      const wide = computeVisibleMeta(widths[i]);
      for (const k of ["duration", "shot", "intent"] as const) {
        // if the narrower row showed it, the wider one must too
        if (narrow[k]) expect(wide[k]).toBe(true);
      }
    }
  });
});

// ─── component: drive width through a mocked ResizeObserver ───────────────────

type ROEntry = { contentRect: { width: number } };
let observers: Array<(entries: ROEntry[]) => void> = [];
let realRO: typeof ResizeObserver | undefined;

class MockResizeObserver {
  cb: (entries: ROEntry[]) => void;
  constructor(cb: (entries: ROEntry[]) => void) {
    this.cb = cb;
    observers.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function emitWidth(width: number) {
  act(() => {
    observers.forEach((cb) => cb([{ contentRect: { width } }]));
  });
}

describe("SceneSummaryRow — meta degrades by priority when narrow", () => {
  beforeEach(() => {
    observers = [];
    realRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      realRO as unknown as typeof ResizeObserver;
    vi.restoreAllMocks();
  });

  it("shows all meta before any measurement (wide default)", () => {
    renderRow();
    expect(screen.getByTestId("summary-duration")).toBeInTheDocument();
    expect(screen.getByTestId("summary-shot")).toBeInTheDocument();
    expect(screen.getByTestId("summary-intent")).toBeInTheDocument();
  });

  it("hides the meta segment when the row reports a narrow width, keeping the title", () => {
    renderRow();
    emitWidth(150);
    // meta shed entirely at the narrowest width …
    expect(screen.queryByTestId("summary-duration")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-shot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-intent")).not.toBeInTheDocument();
    // … but the title is still fully present (not collapsed to an ellipsis).
    expect(
      screen.getByText(FULL_SCENE.title),
    ).toBeInTheDocument();
  });

  it("restores the full meta segment when the row widens again", () => {
    renderRow();
    emitWidth(150);
    expect(screen.queryByTestId("summary-intent")).not.toBeInTheDocument();
    emitWidth(320);
    expect(screen.getByTestId("summary-duration")).toBeInTheDocument();
    expect(screen.getByTestId("summary-shot")).toBeInTheDocument();
    expect(screen.getByTestId("summary-intent")).toBeInTheDocument();
  });

  it("at a mid width keeps duration but drops intent (priority)", () => {
    renderRow();
    emitWidth(240);
    expect(screen.getByTestId("summary-duration")).toBeInTheDocument();
    expect(screen.getByTestId("summary-shot")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-intent")).not.toBeInTheDocument();
  });
});
