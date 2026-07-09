// PRD-0011 F3 — canvas-fps segmented control.
//
// codex review (F3 finding, high): the original implementation wrote fps via
// a PURE local store action (no network) and this file asserted "no fetch is
// called" — locking in a deviation from F3's documented contract ("点击经
// store action 走 F2 路由提交（与 CLI 同路收敛）") and its own predefined test
// ("点击 24 → 发出 bridge 提交（mock fetch 断言 body {fps:24}）；提交失败展示
// 错误行"). Fixed to mirror the established bridge-write precedent this same
// PRD batch already ships (GenerateCaptionsButton.tsx / sceneEdit.ts's
// patchScene): the click POSTs to POST /api/bridge/v1/comp/fps with the
// work-id header — the SAME route `autoviral comp fps` hits — and does NOT
// mutate the store locally (the bridge broadcasts composition-changed, which
// useBridgeEvents refetches into the store — see sceneEdit.ts's "we NEVER
// mutate scenes in the store locally" note for the identical rationale).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { useComposition } from "../../store";
import { makeCompositionWithClips } from "../../../../test/composition-fixtures";

const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { FpsSection } from "./FpsSection";

beforeEach(() => {
  apiFetch.mockReset();
  useComposition.setState({ comp: null, selection: null, currentFrame: 0, isPlaying: false });
});

describe("FpsSection (PRD-0011 F3)", () => {
  it("renders all four fps options and highlights the current value", () => {
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);
    expect(screen.getByRole("group", { name: /frame rate/i })).toBeInTheDocument();
    const active = screen.getByRole("button", { name: "30" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    for (const v of ["24", "25", "60"]) {
      expect(screen.getByRole("button", { name: v })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("clicking 24 POSTs to /api/bridge/v1/comp/fps with the work-id header and body {fps:24}", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { fps: 24 } });
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);

    await userEvent.click(screen.getByRole("button", { name: "24" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, opts] = apiFetch.mock.calls[0] as [string, Record<string, any>];
    expect(path).toBe("/api/bridge/v1/comp/fps");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-AutoViral-Work-Id"]).toBe(comp.workId);
    expect(opts.body).toEqual({ fps: 24 });
  });

  it("does NOT mutate the store locally on submit — convergence is via the composition-changed refetch, not an optimistic local write", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { fps: 24 } });
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);

    await userEvent.click(screen.getByRole("button", { name: "24" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    // The store's own comp.fps is untouched by this component — only the
    // bridge broadcast → useBridgeEvents refetch (exercised at the Studio
    // integration level, not this isolated component test) updates it.
    expect(useComposition.getState().comp!.fps).toBe(30);
  });

  it("submission failure renders an inline error row and leaves the highlighted value unchanged", async () => {
    apiFetch.mockRejectedValueOnce(
      new ApiError("400", 400, { error: "invalid fps" }),
    );
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);

    await userEvent.click(screen.getByRole("button", { name: "24" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/frame rate/i);
    // Still shows 30 as the active value — the failed submit never landed.
    expect(screen.getByRole("button", { name: "30" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders the explanation copy about playback clock & export frame rate", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);
    expect(screen.getByText(/playback clock/i)).toBeInTheDocument();
  });

  it("annotates the 24 option as the Seedance-recommended default", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<FpsSection workId={comp.workId} />);
    expect(screen.getByText(/Seedance/i)).toBeInTheDocument();
  });
});
