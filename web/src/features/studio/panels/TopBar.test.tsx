import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "./TopBar";
import { useTheme } from "@/stores/theme";

beforeEach(() => useTheme.setState({ theme: "dark" }));

describe("TopBar (v4)", () => {
  it("renders the editorial Autoviral italic + Studio v4.0 eyebrow", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Autoviral")).toBeTruthy();
    expect(screen.getByText(/Studio.*v4\.0/i)).toBeTruthy();
  });

  it("theme toggle button flips the theme store", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    const themeBtn = screen.getByLabelText(/theme/i);
    fireEvent.click(themeBtn);
    expect(useTheme.getState().theme).toBe("light");
  });

  it("renders the Export button with 导出 label", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/导出|Export/)).toBeTruthy();
  });
});
