import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportProgress } from "./ExportProgress";
import * as hookMod from "./useRenderJob";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockJob(state: Partial<hookMod.RenderJobView> & { status: hookMod.RenderJobView["status"] }) {
  vi.spyOn(hookMod, "useRenderJob").mockReturnValue({
    job: { id: "job_1", progress: 0.5, log: [], ...state } as hookMod.RenderJobView,
    connected: true,
    cancel: vi.fn(async () => {}),
    cancelError: null,
  });
}

describe("ExportProgress", () => {
  it("renders all 5 stages with the active one highlighted", () => {
    mockJob({ status: "running", stage: "loudnorm", progress: 0.6 });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    expect(screen.getByTestId("stage-render")).toBeInTheDocument();
    expect(screen.getByTestId("stage-duck")).toBeInTheDocument();
    expect(screen.getByTestId("stage-loudnorm")).toBeInTheDocument();
    expect(screen.getByTestId("stage-burn")).toBeInTheDocument();
    expect(screen.getByTestId("stage-encode")).toBeInTheDocument();
    expect(screen.getByTestId("stage-loudnorm")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("stage-render")).toHaveAttribute("data-active", "false");
  });

  it("shows the success state and auto-closes after 1500ms when status=done", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mockJob({ status: "done", progress: 1, outputPath: "/tmp/out.mp4" });
    render(<ExportProgress jobId="job_1" onClose={onClose} onRetry={() => {}} />);
    expect(screen.getByText(/Export complete/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error + Retry button when status=failed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    mockJob({ status: "failed", error: "ffmpeg exit 137", log: [] });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={onRetry} />);
    expect(screen.getByText(/ffmpeg exit 137/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /retry/i });
    await user.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("Cancel button calls hook.cancel() while running", async () => {
    const user = userEvent.setup();
    const cancelSpy = vi.fn(async () => {});
    vi.spyOn(hookMod, "useRenderJob").mockReturnValue({
      job: {
        id: "job_1",
        status: "running",
        progress: 0.4,
        stage: "render",
        log: [],
      } as hookMod.RenderJobView,
      connected: true,
      cancel: cancelSpy,
      cancelError: null,
    });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    expect(cancelBtn).not.toBeDisabled();
    await user.click(cancelBtn);
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it("Cancel button is disabled in terminal states", () => {
    mockJob({ status: "failed", error: "boom" });
    render(<ExportProgress jobId="job_1" onClose={() => {}} onRetry={() => {}} />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    expect(cancelBtn).toBeDisabled();
  });
});
