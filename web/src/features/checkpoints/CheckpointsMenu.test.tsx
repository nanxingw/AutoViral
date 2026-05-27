import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckpointsMenu } from "./CheckpointsMenu";
import { mswServer } from "@/test/msw";

// #90 — the last mile for snapshot naming: a label typed in the menu must
// reach POST /checkpoints, and a labelled checkpoint must surface its name
// in the history list (so multiple snapshots are distinguishable).

function qcWrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CheckpointsMenu — snapshot labels (#90)", () => {
  it("forwards the typed label to POST /checkpoints", async () => {
    const seen: { label?: string }[] = [];
    mswServer.use(
      http.get("/api/works/w1/checkpoints", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post("/api/works/w1/checkpoints", async ({ request }) => {
        seen.push((await request.json()) as { label?: string });
        return HttpResponse.json({ written: ["2026-05-28T00-00-00-000Z__abc12345__composition.yaml"] });
      }),
    );

    render(qcWrap(<CheckpointsMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /history/i }));

    const input = await screen.findByLabelText(/name this snapshot/i);
    await userEvent.type(input, "before risky edit");
    await userEvent.click(screen.getByRole("button", { name: /save snapshot now/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].label).toBe("before risky edit");
  });

  it("omits the label key when the field is blank", async () => {
    const seen: Record<string, unknown>[] = [];
    mswServer.use(
      http.get("/api/works/w1/checkpoints", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post("/api/works/w1/checkpoints", async ({ request }) => {
        seen.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ written: [] });
      }),
    );

    render(qcWrap(<CheckpointsMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    await userEvent.click(screen.getByRole("button", { name: /save snapshot now/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toHaveProperty("label");
  });

  it("renders a checkpoint's label in the history list", async () => {
    mswServer.use(
      http.get("/api/works/w1/checkpoints", () =>
        HttpResponse.json({
          items: [
            {
              file: "2026-05-28T00-00-00-000Z__abc12345__composition.yaml",
              deliverable: "composition.yaml",
              ts: "2026-05-28T00:00:00.000Z",
              sha: "abc12345",
              bytes: 2048,
              label: "before risky edit",
            },
          ],
        }),
      ),
    );

    render(qcWrap(<CheckpointsMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(await screen.findByText("before risky edit")).toBeInTheDocument();
  });

  it("Enter in the label field triggers the snapshot", async () => {
    const seen: { label?: string }[] = [];
    mswServer.use(
      http.get("/api/works/w1/checkpoints", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post("/api/works/w1/checkpoints", async ({ request }) => {
        seen.push((await request.json()) as { label?: string });
        return HttpResponse.json({ written: ["2026-05-28T00-00-00-000Z__abc12345__composition.yaml"] });
      }),
    );

    render(qcWrap(<CheckpointsMenu workId="w1" />));
    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    const input = await screen.findByLabelText(/name this snapshot/i);
    fireEvent.change(input, { target: { value: "milestone v1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].label).toBe("milestone v1");
  });
});
