import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("closes on close button click", () => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /close settings|关闭设置/i }));
    expect(useSettingsPanelStore.getState().open).toBe(false);
  });
});

describe("SettingsPanel — Jimeng + OpenRouter sections", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("loads and renders config fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/config")) {
        return new Response(JSON.stringify({
          jimengAccessKey: "AK123",
          jimengSecretKey: "SK456",
          openrouterKey: "OR789",
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "0 9 * * *",
          model: "sonnet",
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }));

    renderPanel();
    expect(await screen.findByDisplayValue("AK123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SK456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("OR789")).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jimengAccessKey: "AK123", jimengSecretKey: "", openrouterKey: "",
      douyinUrl: "", researchEnabled: false, researchCron: "", model: "sonnet",
    }), { headers: { "content-type": "application/json" } })));
    renderPanel();
    const ak = await screen.findByDisplayValue("AK123") as HTMLInputElement;
    expect(ak.type).toBe("password");
    const toggleBtn = screen.getAllByRole("button", { name: /show|显示/i })[0];
    fireEvent.click(toggleBtn);
    expect(ak.type).toBe("text");
  });
});
