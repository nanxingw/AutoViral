import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ShortcutsCheatsheet } from "./ShortcutsCheatsheet";

// #89 — the cheatsheet is the single source of shortcut discoverability.
// These tests pin that every binding from useShortcuts.ts's header comment
// is actually listed, and that the modal's close affordances all work.

describe("<ShortcutsCheatsheet /> (#89)", () => {
  it("renders a labelled dialog with the keymap grouped", () => {
    render(<ShortcutsCheatsheet onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /keyboard shortcuts/i });
    expect(dialog).toBeInTheDocument();
    // Group headers
    expect(within(dialog).getByText("Playback")).toBeInTheDocument();
    expect(within(dialog).getByText("Editing")).toBeInTheDocument();
    expect(within(dialog).getByText("Clip")).toBeInTheDocument();
  });

  it("lists every binding from the canonical keymap", () => {
    render(<ShortcutsCheatsheet onClose={vi.fn()} />);
    // Descriptions (so a binding can't silently drop out of the cheatsheet)
    for (const desc of [
      /play \/ pause/i,
      /back 5s/i,
      /forward 5s/i,
      /save/i,
      /split at playhead/i,
      /toggle blade mode/i,
      /collapse gaps/i,
      /remove clip/i,
      /ripple-delete/i,
    ]) {
      expect(screen.getByText(desc)).toBeInTheDocument();
    }
    // Key chips for the un-modified bindings.
    expect(screen.getByText("Space")).toBeInTheDocument();
    expect(screen.getByText("J")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    // Backspace appears twice (plain remove + ripple delete).
    expect(screen.getAllByText("Backspace").length).toBeGreaterThanOrEqual(2);
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<ShortcutsCheatsheet onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the Close button closes", () => {
    const onClose = vi.fn();
    render(<ShortcutsCheatsheet onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes but clicking inside the box does not", () => {
    const onClose = vi.fn();
    render(<ShortcutsCheatsheet onClose={onClose} />);
    // Click inside (the title) — must NOT close.
    fireEvent.click(screen.getByText(/keyboard shortcuts/i));
    expect(onClose).not.toHaveBeenCalled();
    // Click the backdrop itself (target === currentTarget) — closes.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
