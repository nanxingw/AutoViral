import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { AITab } from "./AITab";
import { useEditor } from "../../store";
import { makeEmptyCarousel } from "../../types";
import { mswServer } from "@/test/msw";

// Capture every /invoke{assets} POST so we can assert exactly when (and whether)
// the paid + destructive image regen fires.
function captureInvokes() {
  const calls: Record<string, unknown>[] = [];
  mswServer.use(
    http.post("/api/works/w1/invoke", async ({ request }) => {
      calls.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ ok: true });
    }),
  );
  return calls;
}

describe("AITab", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("shows slide count in regenerate button label", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    useEditor.getState().addSlide();
    render(<AITab workId="w1" />);
    expect(screen.getByText(/Regenerate all 2 slides/)).toBeInTheDocument();
  });

  // #71 — a quick-style chip used to fire the paid regen on click with no
  // confirmation. It must now stage the call behind the same cost/destructive
  // dialog the main button uses, and NOT fire until the user confirms.
  it("clicking a quick style does NOT fire the invoke — it opens the confirm dialog", async () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const calls = captureInvokes();
    render(<AITab workId="w1" />);

    fireEvent.click(screen.getByText("soft pastel"));

    // The confirm dialog is open and previews the chip's style…
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("soft pastel")).toBeInTheDocument();
    // …and crucially, nothing was spent yet.
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(0);
  });

  it("confirming the dialog after a quick style fires the assets invoke with the chip's prompt", async () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const calls = captureInvokes();
    render(<AITab workId="w1" />);

    fireEvent.click(screen.getByText("soft pastel"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Regenerate/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].module).toBe("assets");
    expect((calls[0].input as { stylePrompt: string }).stylePrompt).toBe("soft pastel");
  });

  it("cancelling the dialog after a quick style spends nothing", async () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    const calls = captureInvokes();
    render(<AITab workId="w1" />);

    fireEvent.click(screen.getByText("soft pastel"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));

    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(0);
  });
});
