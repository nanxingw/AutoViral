import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScriptModal } from "./ScriptModal";
import { ScriptTab } from "./ScriptTab";
import { useScript } from "../../scriptStore";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import { useLocaleStore } from "@/i18n/store";

// A4 (PRD-0010) — the full-screen 剧本 read/edit modal.
//
// It shares BOTH state and the write path with the inline sidebar editor: it
// reads the `useScript` store and commits on blur through the SAME `saveScript`
// service the agent's `autoviral script edit` CLI hits (ADR-009). We mock that
// service so we can assert the modal commits through it (the "same path" claim)
// without a real network round-trip; the store `setScript` (which drives the
// live sync into the inline panel) is left real.
const saveScript = vi.fn();
const loadScript = vi.fn();
vi.mock("../../services/script", async () => {
  const actual =
    await vi.importActual<typeof import("../../services/script")>(
      "../../services/script",
    );
  return {
    ...actual,
    saveScript: (...args: unknown[]) => saveScript(...args),
    loadScript: (...args: unknown[]) => loadScript(...args),
  };
});

function seedScript(workId: string, md: string) {
  act(() => {
    useScript.getState().setScript(workId, md);
  });
}

beforeEach(() => {
  useScript.getState().reset();
  useComposition.setState({ comp: null, selection: null });
  saveScript.mockReset();
  saveScript.mockResolvedValue(undefined);
  loadScript.mockReset();
  loadScript.mockResolvedValue("");
  useLocaleStore.setState({ locale: "en" });
  try {
    localStorage.removeItem("autoviral.scriptModal.mode");
    localStorage.removeItem("autoviral.scriptPreview.mode");
    localStorage.removeItem("autoviral.scriptFold.collapsed");
  } catch {
    /* jsdom always has localStorage */
  }
});

afterEach(() => {
  useLocaleStore.setState({ locale: "en" });
});

describe("ScriptModal (A4) — full-screen read/edit modal", () => {
  it("uses the shared close IconButton and preserves its click behavior", () => {
    seedScript("w1", "# Outline\n");
    const onClose = vi.fn();
    render(<ScriptModal open workId="w1" onClose={onClose} />);
    const close = screen.getByRole("button", {
      name: "Close full-screen script",
    });
    expect(close).toHaveAttribute("data-icon-button");
    expect(close.querySelector("svg")).not.toBeNull();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a dialog when open, nothing when closed", () => {
    seedScript("w1", "# Outline\n");
    const { rerender } = render(
      <ScriptModal open={false} workId="w1" onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("portals to document.body (glass backdrop-filter fixed-position trap guard)", () => {
    seedScript("w1", "# Outline\n");
    render(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    // The overlay MUST be a direct child of <body>. If it renders inside the
    // sidebar's glass (backdrop-filter) ancestor, that ancestor becomes the
    // containing block for position:fixed and the overlay mis-positions.
    const backdrop = screen.getByTestId("script-modal-backdrop");
    expect(backdrop.parentElement).toBe(document.body);
  });

  it("Esc closes (calls onClose)", () => {
    seedScript("w1", "# Outline\n");
    const onClose = vi.fn();
    render(<ScriptModal open workId="w1" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop (outside) click closes; a click inside the dialog does not", async () => {
    seedScript("w1", "# Outline\n");
    const onClose = vi.fn();
    render(<ScriptModal open workId="w1" onClose={onClose} />);
    // A click inside the dialog body must NOT bubble to close.
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // A click on the backdrop closes.
    fireEvent.click(screen.getByTestId("script-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the modal on open (keyboard reachability)", async () => {
    seedScript("w1", "# Outline\n");
    render(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("reading column is ~720px, ≥15px font, and uses the .md-bubble editorial style", async () => {
    seedScript("w1", "# Outline\n\nThe whole arc.\n");
    render(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    // Non-empty script → opens in preview (the reader). Acceptance criteria:
    // ~720px column, ≥15px font.
    const reader = screen.getByTestId("script-modal-reader");
    expect(reader.style.maxWidth).toContain("720");
    expect(Number.parseFloat(reader.style.fontSize)).toBeGreaterThanOrEqual(15);
    expect(reader.className).toContain("md-bubble");
    // The heading renders as real HTML (shared Markdown component), not raw "#".
    await waitFor(() =>
      expect(within(reader).getByText("Outline")).toBeInTheDocument(),
    );
    expect(reader.textContent).not.toContain("# Outline");
  });

  it("editing → blur commits through the SAME saveScript path as the panel", async () => {
    seedScript("w1", "# Outline\n");
    render(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    // Switch to edit and rewrite the body.
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText("Edit script") as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "# Rewritten");
    fireEvent.blur(textarea);
    await waitFor(() =>
      expect(saveScript).toHaveBeenCalledWith("w1", "# Rewritten"),
    );
  });

  it("does NOT commit when the body is left unchanged (blur with no edit)", async () => {
    seedScript("w1", "# Outline\n");
    render(<ScriptModal open workId="w1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText("Edit script") as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);
    // No content change → no write.
    expect(saveScript).not.toHaveBeenCalled();
  });
});

describe("ScriptModal (A4) — sync with the inline ScriptTab panel", () => {
  it("editing in the modal → save → close reflows the inline panel preview + the shared store", async () => {
    loadScript.mockResolvedValue("# Original\n");
    const comp = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(comp);
    render(<ScriptTab />);

    // The inline panel loads the on-disk script and opens in preview.
    const panelPreview = await screen.findByTestId("script-preview");
    await waitFor(() =>
      expect(within(panelPreview).getByText("Original")).toBeInTheDocument(),
    );

    // Open the full-screen modal from the panel.
    await userEvent.click(
      screen.getByRole("button", { name: "Open full screen" }),
    );
    const dialog = screen.getByRole("dialog");

    // Rewrite the script inside the modal (edit → type → blur commit).
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const textarea = within(dialog).getByLabelText(
      "Edit script",
    ) as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "# Rewritten");
    fireEvent.blur(textarea);
    await waitFor(() =>
      expect(saveScript).toHaveBeenCalledWith("w1", "# Rewritten"),
    );

    // Close the modal.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The shared store carries the rewrite, and the inline panel preview now
    // reflects it — proof the modal and panel share one write path + one store.
    expect(useScript.getState().script).toBe("# Rewritten");
    await waitFor(() =>
      expect(
        within(screen.getByTestId("script-preview")).getByText("Rewritten"),
      ).toBeInTheDocument(),
    );
  });
});
