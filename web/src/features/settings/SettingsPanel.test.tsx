import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { SettingsPanel } from "./SettingsPanel";
import { useSettingsPanelStore } from "@/stores/settings";
import { mswServer } from "@/test/msw";

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
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          jimengAccessKey: "AK123",
          jimengSecretKey: "SK456",
          openrouterKey: "OR789",
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "0 9 * * *",
          model: "sonnet",
        }),
      ),
    );

    renderPanel();
    expect(await screen.findByDisplayValue("AK123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SK456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("OR789")).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          jimengAccessKey: "AK123",
          jimengSecretKey: "",
          openrouterKey: "",
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "",
          model: "sonnet",
        }),
      ),
    );
    renderPanel();
    const ak = await screen.findByDisplayValue("AK123") as HTMLInputElement;
    expect(ak.type).toBe("password");
    const toggleBtn = screen.getAllByRole("button", { name: /show|显示/i })[0];
    fireEvent.click(toggleBtn);
    expect(ak.type).toBe("text");
  });
});

describe("SettingsPanel — Research section", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("renders research toggle + cron input when enabled", async () => {
    mswServer.use(http.get("/api/config", () =>
      HttpResponse.json({
        jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "", researchEnabled: true, researchCron: "0 9 * * *", model: "sonnet",
      })
    ));
    renderPanel();
    expect(await screen.findByRole("switch")).toBeChecked();
    expect(screen.getByDisplayValue("0 9 * * *")).toBeInTheDocument();
  });
});

describe("SettingsPanel — Douyin section", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("triggers refresh on Refresh now click", async () => {
    let refreshCalled = false;
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
          douyinUrl: "https://www.douyin.com/user/abc",
          researchEnabled: false, researchCron: "", model: "sonnet",
          analyticsLastCollectedAt: "2026-05-09T09:00:00Z",
        })
      ),
      http.post("/api/analytics/refresh", async () => {
        refreshCalled = true;
        // Small delay so the React Query pending state is observable
        // before the mutation resolves (otherwise auto-batching can coalesce
        // pending+success into a single render).
        await delay(20);
        return HttpResponse.json({ collectedAt: "2026-05-11T08:00:00Z", worksCount: 42 });
      }),
    );
    renderPanel();

    const refreshBtn = await screen.findByRole("button", { name: /refresh now|立即同步/i });
    expect(refreshBtn).not.toBeDisabled();
    fireEvent.click(refreshBtn);

    await screen.findByText(/refreshing|同步中/i);
    await waitFor(() => expect(refreshCalled).toBe(true));
  });

  it("shows last collected timestamp when present", async () => {
    mswServer.use(http.get("/api/config", () =>
      HttpResponse.json({
        jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "https://www.douyin.com/user/abc",
        researchEnabled: false, researchCron: "", model: "sonnet",
        analyticsLastCollectedAt: "2026-05-09T09:00:00Z",
      })
    ));
    renderPanel();
    expect(await screen.findByText(/last collected|上次同步/i)).toBeInTheDocument();
  });

  it("disables Refresh now when douyinUrl is empty", async () => {
    mswServer.use(http.get("/api/config", () =>
      HttpResponse.json({
        jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "",
        researchEnabled: false, researchCron: "", model: "sonnet",
      })
    ));
    renderPanel();
    const refreshBtn = await screen.findByRole("button", { name: /refresh now|立即同步/i });
    expect(refreshBtn).toBeDisabled();
  });

  it("updates Last collected timestamp after successful refresh", async () => {
    let configCallCount = 0;
    mswServer.use(
      http.get("/api/config", () => {
        configCallCount++;
        return HttpResponse.json({
          jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
          douyinUrl: "https://www.douyin.com/user/abc",
          researchEnabled: false, researchCron: "", model: "sonnet",
          analyticsLastCollectedAt: configCallCount === 1
            ? "2026-05-09T09:00:00.000Z"
            : "2026-05-11T08:00:00.000Z",
        });
      }),
      http.post("/api/analytics/refresh", async () => {
        await delay(20);
        return HttpResponse.json({ collectedAt: "2026-05-11T08:00:00.000Z", worksCount: 42 });
      }),
    );
    renderPanel();

    // Wait for initial render with first timestamp
    const initialPattern = new RegExp(new Date("2026-05-09T09:00:00.000Z").toLocaleString().replace(/[/.,]/g, "\\$&"));
    await screen.findByText(initialPattern);

    // Click refresh
    fireEvent.click(screen.getByRole("button", { name: /refresh now|立即同步/i }));

    // Wait for updated timestamp to appear (after refresh + config re-fetch)
    const updatedPattern = new RegExp(new Date("2026-05-11T08:00:00.000Z").toLocaleString().replace(/[/.,]/g, "\\$&"));
    await waitFor(() => {
      expect(screen.getByText(updatedPattern)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

describe("SettingsPanel — Model section", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("renders model select with loaded value", async () => {
    mswServer.use(http.get("/api/config", () =>
      HttpResponse.json({
        jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "", researchEnabled: false, researchCron: "", model: "opus",
      })
    ));
    renderPanel();
    const select = (await screen.findByLabelText(/default model|默认模型/i)) as HTMLSelectElement;
    expect(select.value).toBe("opus");
  });
});
