import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "./TopBar";

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

  it("does NOT render a theme toggle (delegated to global TopNav)", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/toggle theme/i)).toBeNull();
  });

  it("renders the settings button only when onToggleSettings is provided", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("settings-toggle")).toBeNull();
    rerender(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} onToggleSettings={onToggle} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("settings-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
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
