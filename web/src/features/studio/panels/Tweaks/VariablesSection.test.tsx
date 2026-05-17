import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { VariablesSection } from "./VariablesSection";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";

function loadCompWithVars() {
  const c = makeEmptyComposition({ workId: "w_vars_test" });
  useComposition.setState({
    comp: {
      ...c,
      variables: [
        { id: "title", type: "string", label: "Title", default: "Hello" },
        { id: "year", type: "number", label: "Year", default: 2026 },
        { id: "enabled", type: "boolean", label: "Loop", default: false },
        { id: "accent", type: "color", label: "Accent", default: "#a8c5d6" },
        {
          id: "theme",
          type: "enum",
          label: "Theme",
          default: "light",
          options: [
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
        },
      ],
    },
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
  });
}

describe("VariablesSection (H2.3)", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: null,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
    });
  });

  it("renders 'no variables' state when composition has none", () => {
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w_empty" }),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
    });
    render(<VariablesSection />);
    expect(screen.getByText(/No variables declared/i)).toBeInTheDocument();
  });

  it("renders one input per declared variable, typed appropriately", () => {
    loadCompWithVars();
    render(<VariablesSection />);
    expect(screen.getByLabelText(/Title/i).tagName).toBe("INPUT");
    expect(
      (screen.getByLabelText(/Year/i) as HTMLInputElement).type,
    ).toBe("number");
    expect(
      (screen.getByLabelText(/Loop/i) as HTMLInputElement).type,
    ).toBe("checkbox");
    expect(
      (screen.getByLabelText(/Accent/i) as HTMLInputElement).type,
    ).toBe("color");
    expect(screen.getByLabelText(/Theme/i).tagName).toBe("SELECT");
  });

  it("editing a string variable writes through to the composition store", () => {
    loadCompWithVars();
    render(<VariablesSection />);
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "Pro" },
    });
    const after = useComposition.getState().comp;
    const titleVar = after?.variables?.find((v) => v.id === "title");
    expect(titleVar?.default).toBe("Pro");
  });

  it("editing a number variable coerces to number", () => {
    loadCompWithVars();
    render(<VariablesSection />);
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2030" },
    });
    expect(
      useComposition.getState().comp?.variables?.find((v) => v.id === "year")
        ?.default,
    ).toBe(2030);
  });

  it("toggling a boolean variable writes true/false", () => {
    loadCompWithVars();
    render(<VariablesSection />);
    fireEvent.click(screen.getByLabelText(/Loop/i));
    expect(
      useComposition.getState().comp?.variables?.find((v) => v.id === "enabled")
        ?.default,
    ).toBe(true);
  });
});
