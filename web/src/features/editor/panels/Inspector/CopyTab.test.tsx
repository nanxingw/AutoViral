import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { CopyTab } from "./CopyTab";
import { useEditor } from "../../store";
import { makeEmptyCarousel } from "../../types";
import { mswServer } from "@/test/msw";
import type { Layer } from "../../types";

function seed() {
  useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
  const layer: Layer = {
    id: "t1",
    kind: "text",
    box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
    text: "old",
    style: {
      font: "sans",
      size: 24,
      weight: 400,
      italic: false,
      color: "#000",
      align: "left",
      tracking: 0,
    },
  };
  useEditor.getState().addLayer(layer);
  useEditor.getState().setSelectionLayer("t1");
}

describe("CopyTab", () => {
  beforeEach(() =>
    useEditor.setState({
      car: null,
      currentSlideId: null,
      selectionLayerId: null,
    }),
  );

  it("shows hint when nothing selected", () => {
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<CopyTab workId="w1" />);
    expect(screen.getByText(/Select a text layer/i)).toBeInTheDocument();
  });

  it("typing in textarea updates the layer text", () => {
    seed();
    render(<CopyTab workId="w1" />);
    const ta = screen.getByLabelText("Layer text") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello world" } });
    const layer = useEditor.getState().car!.slides[0].layers[0] as Extract<
      Layer,
      { kind: "text" }
    >;
    expect(layer.text).toBe("hello world");
  });

  it("Rewrite with AI calls /api/works/:id/text-rewrite and applies returned text", async () => {
    seed();
    mswServer.use(
      http.post("/api/works/w1/text-rewrite", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.intent).toBe("rewrite-copy");
        expect(body.current).toBe("old");
        return HttpResponse.json({ text: "rewritten" });
      }),
    );
    render(<CopyTab workId="w1" />);
    fireEvent.click(screen.getByText(/Rewrite with AI/));
    await waitFor(() => {
      const layer = useEditor.getState().car!.slides[0].layers[0] as Extract<
        Layer,
        { kind: "text" }
      >;
      expect(layer.text).toBe("rewritten");
    });
  });
});
