import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { SyncDataButton } from "./SyncDataButton";
import { useSettingsPanelStore } from "@/stores/settings";
import { useLocaleStore } from "@/i18n/store";
import { mswServer } from "@/test/msw";

function renderBtn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SyncDataButton />
    </QueryClientProvider>,
  );
}

describe("<SyncDataButton /> — the 数据-page sync affordance", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: false, focusSection: null });
    useLocaleStore.getState().setLocale("en");
  });
  afterEach(() => useLocaleStore.getState().setLocale("en"));

  it("renders a sync button", () => {
    renderBtn();
    expect(screen.getByRole("button", { name: /sync data/i })).toBeInTheDocument();
  });

  it("on a 401 collector_relogin, shows the actionable re-login copy AND a jump-to-Settings(douyin) button", async () => {
    mswServer.use(
      http.post("*/api/analytics/refresh", () =>
        HttpResponse.json(
          { error: "expired", errorCode: "collector_relogin" },
          { status: 401 },
        ),
      ),
    );
    renderBtn();
    fireEvent.click(screen.getByRole("button", { name: /sync data/i }));

    // The localized relogin guidance (mentions douyin.com) must surface — not a bare error.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/douyin\.com/i),
    );

    // And the actionable jump must open Settings focused on the douyin section.
    const jump = screen.getByRole("button", { name: /open douyin settings/i });
    fireEvent.click(jump);
    expect(useSettingsPanelStore.getState().open).toBe(true);
    expect(useSettingsPanelStore.getState().focusSection).toBe("douyin");
  });
});
