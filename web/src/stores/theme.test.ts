import { describe, it, expect, beforeEach } from "vitest";
import { useTheme } from "./theme";

describe("useTheme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useTheme.setState({ theme: "dark" });
  });

  it("persists theme to localStorage and applies data-theme attribute", () => {
    useTheme.getState().setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("av-theme")).toBe("light");
  });

  it("toggles between dark and light", () => {
    useTheme.setState({ theme: "dark" });
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("light");
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("dark");
  });
});
