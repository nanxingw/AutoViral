import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { useSettingsPanelStore } from "@/stores/settings";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPanel />
    </QueryClientProvider>
  );
}

describe("SettingsPanel — skeleton", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: false, focusSection: null });
  });

  it("renders nothing when closed", () => {
    renderPanel();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the panel when open", () => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
    renderPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
    renderPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useSettingsPanelStore.getState().open).toBe(false);
  });

  it("closes on backdrop click", () => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
    renderPanel();
    const backdrop = screen.getByTestId("settings-backdrop");
    fireEvent.click(backdrop);
    expect(useSettingsPanelStore.getState().open).toBe(false);
  });
});
