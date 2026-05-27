import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
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

function textLayer(id: string, text: string): Layer {
  return {
    id,
    kind: "text",
    box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 },
    text,
    style: { font: "sans", size: 24, weight: 400, italic: false, color: "#000", align: "left", tracking: 0 },
  };
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

  // #66 — removeLayer had zero UI. The delete button is its first call site,
  // two-click confirmed (no inline undo in the editor).
  it("first click on delete arms a confirm but does NOT remove the layer (#66)", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete layer$/i }));
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Click again to delete/i })).toBeInTheDocument();
  });

  it("second click removes the layer and clears the selection (#66)", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete layer$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Click again to delete/i }));
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(0);
    expect(useEditor.getState().selectionLayerId).toBeNull();
  });

  it("switching to a different layer disarms a primed delete (#66)", () => {
    seed(); // t1 selected
    useEditor.getState().addLayer(textLayer("t2", "second")); // addLayer selects t2
    act(() => useEditor.getState().setSelectionLayer("t1"));
    render(<CopyTab workId="w1" />);

    fireEvent.click(screen.getByRole("button", { name: /^Delete layer$/i })); // arm on t1
    expect(screen.getByRole("button", { name: /Click again to delete/i })).toBeInTheDocument();

    act(() => useEditor.getState().setSelectionLayer("t2")); // change selection
    // re-armed state cleared: button is back to the un-primed label, both layers intact
    expect(screen.getByRole("button", { name: /^Delete layer$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Click again to delete/i })).toBeNull();
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(2);
  });
});

// #81 — per-layer text style controls. The schema + Konva TextLayerNode
// already supported color/size/font/weight/italic/align/tracking; CopyTab
// only ever wrote `text`. These pin each control to its style field and
// guard the shallow-merge (updateLayer Object.assign) sibling-preservation.
describe("CopyTab — per-layer style controls (#81)", () => {
  beforeEach(() =>
    useEditor.setState({ car: null, currentSlideId: null, selectionLayerId: null }),
  );

  const liveStyle = () => {
    const l = useEditor.getState().car!.slides[0].layers[0] as Extract<
      Layer,
      { kind: "text" }
    >;
    return l.style;
  };

  it("color picker writes style.color", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#ff0000" },
    });
    expect(liveStyle().color).toBe("#ff0000");
  });

  it("size input writes style.size and clamps to the 240 ceiling", () => {
    seed();
    render(<CopyTab workId="w1" />);
    const size = screen.getByLabelText("Size");
    fireEvent.change(size, { target: { value: "72" } });
    expect(liveStyle().size).toBe(72);
    fireEvent.change(size, { target: { value: "9999" } });
    expect(liveStyle().size).toBe(240);
  });

  it("font select writes the font enum", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "serif" } });
    expect(liveStyle().font).toBe("serif");
  });

  it("weight select writes a numeric style.weight", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "800" } });
    expect(liveStyle().weight).toBe(800);
    expect(typeof liveStyle().weight).toBe("number");
  });

  it("align select writes style.align", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Align"), { target: { value: "right" } });
    expect(liveStyle().align).toBe("right");
  });

  it("tracking input writes style.tracking (negative allowed)", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Tracking"), { target: { value: "-4" } });
    expect(liveStyle().tracking).toBe(-4);
  });

  it("italic checkbox toggles style.italic", () => {
    seed();
    render(<CopyTab workId="w1" />);
    fireEvent.click(screen.getByLabelText("Italic"));
    expect(liveStyle().italic).toBe(true);
  });

  it("a style edit preserves the sibling style fields (shallow-merge guard)", () => {
    seed(); // size:24, font:sans, weight:400
    render(<CopyTab workId="w1" />);
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#00ff00" },
    });
    const s = liveStyle();
    expect(s.color).toBe("#00ff00");
    expect(s.size).toBe(24);
    expect(s.font).toBe("sans");
    expect(s.weight).toBe(400);
  });
});
