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

  it("shows the success state and stays open with Close + open-output affordance when status=done", () => {
    // R43 — done no longer auto-closes. Pre-fix the modal vanished
    // 1500ms after done with no link to the produced file; the new
    // contract keeps it open until the user dismisses.
    vi.useFakeTimers();
    const onClose = vi.fn();
    mockJob({ status: "done", progress: 1, outputPath: "/tmp/out.mp4" });
    render(<ExportProgress jobId="job_1" workId="w-1" onClose={onClose} onRetry={() => {}} />);
    expect(screen.getByText(/Export complete/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    // Open link points to the served URL, derived from outputPath basename.
    const openLink = screen.getByRole("link", { name: /open/i });
    expect(openLink).toHaveAttribute(
      "href",
      "/api/works/w-1/assets/output/out.mp4",
    );
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

  it("Cancel slot becomes Close in terminal states (R43 — same slot, different verb)", async () => {
    // Pre-fix: button stayed labelled "Cancel" but went disabled, leaving
    // users stuck if they couldn't find a corner X. Now the same slot
    // turns into "Close" + onClose.
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockJob({ status: "failed", error: "boom" });
    render(<ExportProgress jobId="job_1" onClose={onClose} onRetry={() => {}} />);
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
    ).not.toBeInTheDocument();
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).not.toBeDisabled();
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
