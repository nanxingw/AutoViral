import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useExport } from "./useExport";
import { useEditor } from "../store";
import type { Carousel } from "../types";

// #85 — exportAll exposes `exporting` + `progress` (was zero feedback) and a
// useRef reentrancy guard (a double-click must not launch two exports).
// We mock the PNG service so the hook's state machine is what's under test,
// not Konva/toDataURL.

let resolveExport: (() => void) | null = null;

vi.mock("../services/exportPng", () => ({
  exportSinglePng: vi.fn(),
  exportAllPngs: vi.fn(async (_id: string, cb: (s: string) => Promise<string>) => {
    const slides = useEditor.getState().car?.slides ?? [];
    for (const s of slides) await cb(s.id);
    // Hold the export open until the test releases it (reentrancy test).
    if (resolveExport) await new Promise<void>((r) => (resolveExport = r));
  }),
}));

vi.mock("../services/captureWhenChanged", () => ({
  captureWhenChanged: vi.fn(async () => ({ dataUrl: "data:image/png;base64,xx", timedOut: false })),
}));

function carWithSolidSlides(n: number): Carousel {
  return {
    id: "c1",
    workId: "w1",
    globals: { palette: "ink", layout: "centered", headlineFont: "serif" },
    slides: Array.from({ length: n }, (_, i) => ({
      id: `s${i + 1}`,
      bg: { type: "solid" as const, value: "#111" },
      layers: [],
    })),
  } as unknown as Carousel;
}

function Harness() {
  const { exportAll, exporting, progress } = useExport();
  return (
    <div>
      <button onClick={() => void exportAll()}>go</button>
      <span data-testid="exporting">{String(exporting)}</span>
      <span data-testid="progress">{progress.done}/{progress.total}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveExport = null;
  useEditor.setState({ car: carWithSolidSlides(3), currentSlideId: "s1" });
});

describe("useExport — exportAll progress + reentrancy (#85)", () => {
  it("toggles exporting and advances progress to total, then resets", async () => {
    render(<Harness />);
    expect(screen.getByTestId("exporting")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("go"));

    // exporting flips on, progress reaches 3/3, then exporting flips off.
    await waitFor(() =>
      expect(screen.getByTestId("progress")).toHaveTextContent("3/3"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("exporting")).toHaveTextContent("false"),
    );
  });

  it("a double-click does not launch two exports (useRef reentrancy guard)", async () => {
    const { exportAllPngs } = await import("../services/exportPng");
    // Hold the first export open so the second click overlaps it.
    resolveExport = () => {};
    render(<Harness />);

    const btn = screen.getByText("go");
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while first is in flight

    await waitFor(() => expect(screen.getByTestId("exporting")).toHaveTextContent("true"));
    expect(exportAllPngs).toHaveBeenCalledTimes(1);

    // Release the in-flight export so the test doesn't leak a pending promise.
    resolveExport?.();
    await waitFor(() => expect(screen.getByTestId("exporting")).toHaveTextContent("false"));
  });
});
