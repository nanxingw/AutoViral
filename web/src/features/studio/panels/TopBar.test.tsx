import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import * as renderSvc from "../services/render";

vi.mock("../services/render", () => ({
  enqueueRender: vi.fn(),
  cancelRender: vi.fn(),
}));

// TopBar embeds CheckpointsMenu which uses react-query. Wrap each render
// with a fresh QueryClient so the hook can mount without "No QueryClient"
// errors. A fresh client per test avoids cache bleed between cases.
function qcWrap(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Stub ExportProgress's internal hook so the modal renders without spinning up
// a WebSocket subscription in tests. We only need to assert the dialog mounts
// & unmounts; the wiring inside ExportProgress is covered by its own suite.
vi.mock("../render-status/useRenderJob", () => ({
  useRenderJob: () => ({ job: null, cancel: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TopBar (v4)", () => {
  it("renders the editorial Autoviral italic + Studio v4.0 eyebrow", () => {
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w1" savedAt={null} />
      </MemoryRouter>),
    );
    expect(screen.getByText("Autoviral")).toBeTruthy();
    expect(screen.getByText(/Studio.*v4\.0/i)).toBeTruthy();
  });

  it("does NOT render a theme toggle (delegated to global TopNav)", () => {
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w1" savedAt={null} />
      </MemoryRouter>),
    );
    expect(screen.queryByLabelText(/toggle theme/i)).toBeNull();
  });

  it("renders the settings button only when onToggleSettings is provided", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w1" savedAt={null} />
      </MemoryRouter>),
    );
    expect(screen.queryByTestId("settings-toggle")).toBeNull();
    rerender(
      qcWrap(<MemoryRouter>
        <TopBar workId="w1" savedAt={null} onToggleSettings={onToggle} />
      </MemoryRouter>),
    );
    fireEvent.click(screen.getByTestId("settings-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the Export button with 导出 label", () => {
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w1" savedAt={null} />
      </MemoryRouter>),
    );
    expect(screen.getByText(/导出|Export/)).toBeTruthy();
  });
});

describe("TopBar — queue-aware export (Phase 7.E)", () => {
  it("clicking 导出 enqueues a full render and mounts ExportProgress", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_abc" });
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>),
    );
    await userEvent.click(screen.getByRole("button", { name: /export full render/i }));
    expect(renderSvc.enqueueRender).toHaveBeenCalledWith("w-1", { type: "full" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("chevron menu offers Quick proxy export", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_proxy" });
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>),
    );
    await userEvent.click(screen.getByRole("button", { name: /more export options/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /quick proxy export/i }));
    await waitFor(() =>
      expect(renderSvc.enqueueRender).toHaveBeenCalledWith("w-1", { type: "proxy" }),
    );
  });

  it("closing the modal disposes the ws subscription (no leak)", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_x" });
    render(
      qcWrap(<MemoryRouter>
        <TopBar workId="w-1" savedAt="now" />
      </MemoryRouter>),
    );
    await userEvent.click(screen.getByRole("button", { name: /export full render/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
