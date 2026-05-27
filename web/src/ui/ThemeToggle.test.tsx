import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "@/stores/theme";

describe("<ThemeToggle />", () => {
  beforeEach(() => {
    useTheme.setState({ theme: "dark" });
  });

  it("renders sun icon when theme is dark and moon when light", () => {
    render(<ThemeToggle />);
    // F31/F32 a11y: the label is target-state-aware ("Switch to light theme"
    // when currently dark) — it no longer reads the static "Toggle theme".
    expect(screen.getByLabelText(/switch to (light|dark) theme/i)).toBeInTheDocument();
    expect(document.querySelector("[data-icon='sun']")).toBeInTheDocument();
  });

  it("toggles theme on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByLabelText(/switch to (light|dark) theme/i));
    expect(useTheme.getState().theme).toBe("light");
  });
});
