import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CommandMenu,
  type ChatCommandCatalog,
} from "./CommandMenu";

const localCommands: ChatCommandCatalog["commands"] = [
  {
    name: "model",
    backend: "claude",
    kind: "local",
    args: { required: true, placeholder: "model" },
    availability: { available: true },
    description: "Set model",
    denyPolicy: "allow",
  },
  {
    name: "new",
    backend: "claude",
    kind: "local",
    args: { required: false },
    availability: { available: true },
    description: "New session",
    denyPolicy: "allow",
  },
];

const claudeCatalog: ChatCommandCatalog = {
  sessionId: "s_1",
  backend: "claude",
  commands: [
    ...localCommands,
    {
      name: "compact",
      backend: "claude",
      kind: "passthrough",
      args: { required: false },
      availability: {
        available: false,
        reasonCode: "history_required",
        reason: "/compact requires an existing conversation.",
      },
      description: "Compact context",
      denyPolicy: "allow",
    },
    {
      name: "storyboard",
      backend: "claude",
      kind: "passthrough",
      args: { required: false, placeholder: "arguments" },
      availability: { available: true },
      description: "Claude skill /storyboard.",
      denyPolicy: "safe_dynamic_only",
    },
  ],
};

function Harness({
  catalog = claudeCatalog,
  onRun = vi.fn(),
}: {
  catalog?: ChatCommandCatalog;
  onRun?: (name: string, args: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <CommandMenu
      value={value}
      catalog={catalog}
      onValueChange={setValue}
      onRun={onRun}
      textareaProps={{ "aria-label": "Chat composer", rows: 2 }}
    />
  );
}

describe("CommandMenu", () => {
  it("opens only for a leading slash, filters, and live-updates with the session catalog", async () => {
    const { rerender } = render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Chat composer" });

    await userEvent.type(input, "/co");
    expect(screen.getByRole("listbox", { name: /commands/i })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /compact/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText(/requires an existing conversation/i)).toBeInTheDocument();

    const codexCatalog: ChatCommandCatalog = {
      sessionId: "s_2",
      backend: "codex",
      commands: localCommands.map((command) => ({ ...command, backend: "codex" })),
    };
    rerender(<Harness catalog={codexCatalog} />);
    expect(screen.queryByRole("option", { name: /compact/i })).not.toBeInTheDocument();
  });

  it("exposes listbox semantics and supports Down, Up, Tab, Enter, and Escape", async () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    const input = screen.getByRole("textbox", { name: "Chat composer" });
    await userEvent.type(input, "/");

    const listbox = screen.getByRole("listbox", { name: /commands/i });
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("/model ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "/new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith("new", "");

    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("does not open for a slash in the middle of a sentence or a URL", () => {
    const { rerender } = render(
      <CommandMenu
        value="please use /compact"
        catalog={claudeCatalog}
        onValueChange={vi.fn()}
        onRun={vi.fn()}
        textareaProps={{ "aria-label": "Chat composer" }}
      />,
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    rerender(
      <CommandMenu
        value="https://x.test/path"
        catalog={claudeCatalog}
        onValueChange={vi.fn()}
        onRun={vi.fn()}
        textareaProps={{ "aria-label": "Chat composer" }}
      />,
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not execute while IME composition is active", () => {
    const onRun = vi.fn();
    render(
      <CommandMenu
        value="/new"
        catalog={claudeCatalog}
        onValueChange={vi.fn()}
        onRun={onRun}
        textareaProps={{ "aria-label": "Chat composer" }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      isComposing: true,
    });
    expect(onRun).not.toHaveBeenCalled();
  });
});
