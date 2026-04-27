import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { AITab } from "./AITab";
import { useEditor } from "../../store";
import { makeEmptyCarousel } from "../../types";
import { mswServer } from "@/test/msw";

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

  it("clicking a quick style sends assets invoke", async () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    let captured: Record<string, unknown> | null = null;
    mswServer.use(
      http.post("/api/works/w1/invoke", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<AITab workId="w1" />);
    fireEvent.click(screen.getByText("soft pastel"));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.module).toBe("assets");
    expect((captured!.input as { stylePrompt: string }).stylePrompt).toBe(
      "soft pastel",
    );
  });
});
