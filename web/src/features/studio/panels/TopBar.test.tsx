import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import * as renderSvc from "../services/render";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";

// Mock only the network calls; keep the real `resolveRenderOpts` (a pure
// merge helper, #80) so the export path exercises the actual preset bridge.
vi.mock("../services/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/render")>();
  return {
    ...actual,
    enqueueRender: vi.fn(),
    cancelRender: vi.fn(),
  };
});

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

  // #80 — end-to-end bridge: a stored platform preset whose loudness target
  // is NOT the server default (-14) must reach the render request. Without
  // the resolveRenderOpts wiring in startExport, the WeChat Channels -16
  // target was silently dropped and every export normalised to -14.
  it("forwards the active preset's loudnessTargetLufs into the render request (#80)", async () => {
    (renderSvc.enqueueRender as any).mockResolvedValue({ jobId: "job_wx" });
    const comp = makeEmptyComposition({ workId: "w-1" });
    comp.exportPresets = [
      {
        id: "weixin-channels",
        label: "视频号 9:16",
        platform: "weixin-channels",
        width: 1080,
        height: 1920,
        fps: 30,
        videoBitrate: 8_000_000,
        audioBitrate: 192_000,
        codec: "h264",
        container: "mp4",
        loudnessTargetLufs: -16,
        safeZonePct: 0.05,
      },
    ];
    useComposition.setState({ comp });
    try {
      render(
        qcWrap(<MemoryRouter>
          <TopBar workId="w-1" savedAt="now" />
        </MemoryRouter>),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /export full render/i }),
      );
      await waitFor(() => {
        const call = (renderSvc.enqueueRender as any).mock.calls.at(-1);
        expect(call?.[0]).toBe("w-1");
        expect(call?.[1]).toMatchObject({
          type: "full",
          loudnessTargetLufs: -16,
          presetId: "weixin-channels",
        });
      });
    } finally {
      // Don't leak the seeded comp into sibling tests (zustand is a
      // module-level singleton).
      useComposition.setState({ comp: null });
    }
  });
});
