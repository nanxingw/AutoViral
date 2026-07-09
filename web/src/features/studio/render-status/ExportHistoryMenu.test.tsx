import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExportHistoryMenu } from "./ExportHistoryMenu";
import { mswServer } from "@/test/msw";

// S6 (PRD-0012 / issue 027 root-cause 5) — once the ExportProgress modal is
// closed, this dropdown is the only way to find a finished export again.
// It reuses the exact three affordances ExportProgress already ships
// (download / reveal-in-Finder / preview) so the two surfaces agree.

function qcWrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const DONE_JOB = {
  id: "job_2",
  workId: "w1",
  type: "full" as const,
  presetId: "douyin",
  status: "done" as const,
  progress: 1,
  outputPath: "/Users/x/works/w1/output/final-20260709-0610.mp4",
  createdAt: "2026-07-09T06:10:00.000Z",
  finishedAt: "2026-07-09T06:12:00.000Z",
};

const FAILED_JOB = {
  id: "job_1",
  workId: "w1",
  type: "full" as const,
  status: "failed" as const,
  progress: 0.4,
  error: "ffmpeg exit 1",
  createdAt: "2026-07-09T05:00:00.000Z",
};

describe("ExportHistoryMenu (S6)", () => {
  it("renders N history rows with timestamp, preset and status", async () => {
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () =>
        HttpResponse.json({ jobs: [DONE_JOB, FAILED_JOB] }),
      ),
    );
    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /renders/i }));

    const rows = await screen.findAllByTestId("export-history-row");
    expect(rows).toHaveLength(2);

    const doneRow = rows.find((r) => r.dataset.status === "done")!;
    expect(within(doneRow).getByText("douyin")).toBeInTheDocument();
    expect(within(doneRow).getByText(/final-20260709-0610\.mp4/)).toBeInTheDocument();

    const failedRow = rows.find((r) => r.dataset.status === "failed")!;
    expect(within(failedRow).getByText(/ffmpeg exit 1/)).toBeInTheDocument();
  });

  it("a done job with output_path exposes download/reveal/preview with correct href + handler", async () => {
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () =>
        HttpResponse.json({ jobs: [DONE_JOB] }),
      ),
    );
    const revealSeen: unknown[] = [];
    mswServer.use(
      http.post("/api/render/reveal", async ({ request }) => {
        revealSeen.push(await request.json());
        return HttpResponse.json({ ok: true, platform: "darwin" });
      }),
    );

    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /renders/i }));

    const row = await screen.findByTestId("export-history-row");
    const downloadLink = within(row).getByRole("link", { name: /download/i });
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/works/w1/assets/output/final-20260709-0610.mp4",
    );
    expect(downloadLink).toHaveAttribute("download", "final-20260709-0610.mp4");

    const previewLink = within(row).getByRole("link", { name: /preview/i });
    expect(previewLink).toHaveAttribute(
      "href",
      "/api/works/w1/assets/output/final-20260709-0610.mp4",
    );
    expect(previewLink).toHaveAttribute("target", "_blank");

    const revealBtn = within(row).getByRole("button", { name: /finder/i });
    await userEvent.click(revealBtn);
    await waitFor(() => expect(revealSeen).toHaveLength(1));
    expect(revealSeen[0]).toEqual({
      workId: "w1",
      filename: "final-20260709-0610.mp4",
    });
  });

  it("a failed job shows no download/reveal/preview affordances", async () => {
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () =>
        HttpResponse.json({ jobs: [FAILED_JOB] }),
      ),
    );
    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /renders/i }));

    const row = await screen.findByTestId("export-history-row");
    expect(within(row).queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /finder/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /preview/i })).not.toBeInTheDocument();
  });

  it("renders the empty-state copy when there is no export history", async () => {
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () => HttpResponse.json({ jobs: [] })),
    );
    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /renders/i }));

    expect(await screen.findByText(/no renders yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("export-history-row")).not.toBeInTheDocument();
  });

  // codex review (S6 finding, medium) — closing then reopening the menu
  // shortly after a render completes must re-fetch, not serve a stale cache
  // (staleTime previously masked a just-finished export until the 5s window
  // elapsed).
  it("re-fetches every time the menu is reopened, not just on first open", async () => {
    let calls = 0;
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () => {
        calls += 1;
        return HttpResponse.json({ jobs: calls === 1 ? [] : [DONE_JOB] });
      }),
    );
    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    const trigger = screen.getByRole("button", { name: /renders/i });

    await userEvent.click(trigger); // open #1 — empty
    await screen.findByText(/no renders yet/i);
    await userEvent.click(trigger); // close

    await userEvent.click(trigger); // open #2 — the render finished meanwhile
    expect(await screen.findAllByTestId("export-history-row")).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  // codex review (S6 finding, medium) — a 503 (RenderQueue not initialized)
  // must render as a DISTINCT error state, not silently collapse into the
  // generic "no renders yet" empty copy (which would misrepresent "the
  // service can't answer" as "this work genuinely has no history").
  it("renders a distinct error state (not the empty copy) on a 503, with a retry that recovers", async () => {
    let attempt = 0;
    mswServer.use(
      http.get("/api/works/w1/render/jobs", () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            { error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" },
            { status: 503 },
          );
        }
        return HttpResponse.json({ jobs: [DONE_JOB] });
      }),
    );
    render(qcWrap(<ExportHistoryMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /renders/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/render queue/i);
    expect(screen.queryByText(/no renders yet/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findAllByTestId("export-history-row")).toHaveLength(1);
  });
});
