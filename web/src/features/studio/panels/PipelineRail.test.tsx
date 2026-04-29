import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineRail } from "./PipelineRail";

describe("PipelineRail", () => {
  it("renders 5 stage pills with English+Chinese labels", () => {
    render(<PipelineRail />);
    expect(screen.getByText("研究")).toBeTruthy();
    expect(screen.getByText("脚本")).toBeTruthy();
    expect(screen.getByText("生成")).toBeTruthy();
    expect(screen.getByText("剪辑")).toBeTruthy();
    expect(screen.getByText("响度")).toBeTruthy();
  });

  it("shows TOTAL footer with eval indicator", () => {
    render(<PipelineRail />);
    expect(screen.getByText(/TOTAL/)).toBeTruthy();
    expect(screen.getByText(/EVAL/)).toBeTruthy();
  });

  it("renders the 'running' stage with an aria-current marker", () => {
    render(<PipelineRail />);
    const running = screen.getByTestId("rail-stage-generation");
    expect(running.getAttribute("data-status")).toBe("running");
  });
});
