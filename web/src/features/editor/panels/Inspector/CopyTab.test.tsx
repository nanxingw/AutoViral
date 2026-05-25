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

  it("empty slide shows the no-text-layer hint AND an add-layer affordance (#43)", () => {
    // makeEmptyCarousel → one slide with layers: []. Before #43 this tab was a
    // dead end (just a hint, no way to add a layer). It must now offer one.
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<CopyTab workId="w1" />);
    expect(screen.getByText(/no text layer yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add text layer/i })).toBeInTheDocument();
  });

  it("clicking add-text-layer wires addLayer → new text layer appears + becomes editable (#43)", () => {
    // The last-mile regression guard the issue asked for: store had addLayer
    // with full coverage but zero UI call sites. Clicking the button must push
    // a text layer onto the current slide, select it, and reveal the textarea.
    useEditor.getState().loadCarousel(makeEmptyCarousel("w1"));
    render(<CopyTab workId="w1" />);
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Add text layer/i }));

    const layers = useEditor.getState().car!.slides[0].layers;
    expect(layers).toHaveLength(1);
    expect(layers[0].kind).toBe("text");
    // addLayer selects the new layer → the edit textarea is now reachable.
    expect(useEditor.getState().selectionLayerId).toBe(layers[0].id);
    expect(screen.getByLabelText("Layer text")).toBeInTheDocument();
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
