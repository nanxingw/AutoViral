// A6 (PRD-0010) — PeaksSvg pure-render unit tests.
//
// PeaksSvg is the shared "peaks[] → svg bars" renderer extracted from
// WaveformBars so the timeline clip waveform and the AUDIO library row's
// mini waveform share one code path (and one useWaveform peaks cache).
// Contract:
//   - one <rect> per peak, height normalized to peak*100 (2-unit floor),
//     inside a 0 0 barCount 100 viewBox so it stretches to width×height;
//   - empty peaks (or width<=0) → a loading skeleton (no <svg>).
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PeaksSvg } from "./PeaksSvg";

describe("PeaksSvg", () => {
  it("renders one <rect> per peak", () => {
    const { container } = render(
      <PeaksSvg peaks={[0.2, 0.5, 0.9, 0.1]} width={100} height={40} />,
    );
    const svg = container.querySelector('svg[aria-label="waveform"]');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("rect").length).toBe(4);
  });

  it("normalizes bar height to peak*100 with a 2-unit floor", () => {
    const { container } = render(
      <PeaksSvg peaks={[1, 0]} width={50} height={40} />,
    );
    const rects = container.querySelectorAll("rect");
    // peak=1 → h=100 (full column); peak=0 → h=max(2, 0)=2 (visible floor).
    expect(rects[0].getAttribute("height")).toBe("100");
    expect(rects[1].getAttribute("height")).toBe("2");
    // Vertically centered: y = (100 - h) / 2.
    expect(rects[0].getAttribute("y")).toBe("0");
    expect(rects[1].getAttribute("y")).toBe("49");
  });

  it("sizes the svg from width/height props", () => {
    const { container } = render(
      <PeaksSvg peaks={[0.5]} width={160} height={48} />,
    );
    const svg = container.querySelector('svg[aria-label="waveform"]')!;
    expect(svg.getAttribute("width")).toBe("160");
    expect(svg.getAttribute("height")).toBe("48");
    expect(svg.getAttribute("viewBox")).toBe("0 0 4 100");
  });

  it("renders a skeleton (no svg) when peaks is empty", () => {
    const { container } = render(
      <PeaksSvg peaks={[]} width={100} height={40} />,
    );
    expect(container.querySelector('svg[aria-label="waveform"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="waveform-loading"]'),
    ).not.toBeNull();
  });

  it("renders a skeleton when width <= 0", () => {
    const { container } = render(
      <PeaksSvg peaks={[0.5, 0.5]} width={0} height={40} />,
    );
    expect(container.querySelector('svg[aria-label="waveform"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="waveform-loading"]'),
    ).not.toBeNull();
  });

  it("renders about one 3px bar plus 1px gap per 4px of width", () => {
    const peaks = Array.from({ length: 128 }, (_, index) => (index + 1) / 128);
    const { container } = render(<PeaksSvg peaks={peaks} width={160} height={48} />);
    expect(container.querySelectorAll("rect")).toHaveLength(40);
    expect(container.querySelector("rect")).toHaveAttribute("width", "3");
  });
});
