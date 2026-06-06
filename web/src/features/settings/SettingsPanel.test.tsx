import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
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

describe("SettingsPanel — OpenRouter section", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("loads and renders openrouter field", async () => {
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          openrouterKey: "",
          secretMeta: {
            openrouterKey: { set: true, lastFour: "AKLT" },
          },
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "0 9 * * *",
          model: "sonnet",
          analyticsLastCollectedAt: null,
        }),
      ),
    );
    renderPanel();

    // The OpenRouter section is rendered with its API Key SecretField.
    const section = await waitFor(() => {
      const el = document.querySelector('[data-section="openrouter"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // SecretField input lives inside the section.
    const input = section.querySelector("input");
    expect(input).not.toBeNull();
    // Stored-secret hint surfaces the last-4 tail.
    const hint = await screen.findByTestId("secret-stored-hint");
    expect(hint.textContent).toContain("AKLT");
  });

  it("save flow — typing into the openrouter input then clicking Save sends PUT body with openrouterKey populated", async () => {
    let savedBody: any = null;
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          openrouterKey: "",
          secretMeta: { openrouterKey: { set: false, lastFour: "" } },
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "0 9 * * *",
          model: "sonnet",
          analyticsLastCollectedAt: null,
        }),
      ),
      http.put("/api/config", async ({ request }) => {
        savedBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPanel();

    const section = await waitFor(() => {
      const el = document.querySelector('[data-section="openrouter"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const input = section.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-or-newkey-123" } });

    const saveBtn = screen.getByRole("button", { name: /save changes|保存/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(savedBody).not.toBeNull());
    expect(savedBody.openrouterKey).toBe("sk-or-newkey-123");
  });

  it("blank openrouterKey in body means leave-alone (R109 F475 semantics)", async () => {
    let savedBody: any = null;
    mswServer.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          openrouterKey: "",
          secretMeta: { openrouterKey: { set: true, lastFour: "AKLT" } },
          // A non-secret field must be dirty for Save to be enabled; we
          // toggle researchEnabled to force the patch through with the
          // openrouterKey staying blank.
          douyinUrl: "",
          researchEnabled: false,
          researchCron: "0 9 * * *",
          model: "sonnet",
          analyticsLastCollectedAt: null,
        }),
      ),
      http.put("/api/config", async ({ request }) => {
        savedBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPanel();

    // Wait for the openrouter section + secret hint to confirm config loaded.
    await screen.findByTestId("secret-stored-hint");

    // Flip the research switch to make the form dirty without touching the secret.
    const researchSwitch = screen.getByRole("switch");
    fireEvent.click(researchSwitch);

    const saveBtn = screen.getByRole("button", { name: /save changes|保存/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => expect(savedBody).not.toBeNull());
    // Empty string means "leave-alone" on the server (R109 F475 semantics).
    expect(savedBody.openrouterKey).toBe("");
  });
});

describe("SettingsPanel — Douyin collector (S5)", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  const douyinConfig = {
    openrouterKey: "",
    secretMeta: { openrouterKey: { set: false, lastFour: "" } },
    // douyinUrl must be set or the refresh button is disabled.
    douyinUrl: "https://www.douyin.com/user/abc",
    researchEnabled: false,
    researchCron: "0 9 * * *",
    model: "sonnet",
    analyticsLastCollectedAt: null,
  };

  it("renders the cookie-consent disclosure before refreshing (privacy is explicit)", async () => {
    mswServer.use(http.get("/api/config", () => HttpResponse.json(douyinConfig)));
    renderPanel();

    // The consent block names the douyin.com sessionid cookie + local-only promise.
    const consent = await screen.findByTestId("douyin-cookie-consent");
    expect(consent.textContent).toMatch(/sessionid|cookie/i);
    expect(consent.textContent).toMatch(/local|never uploaded|绝不上传|本地/i);
  });

  it("surfaces an ACTIONABLE re-login prompt when refresh returns collector_relogin (401)", async () => {
    mswServer.use(
      http.get("/api/config", () => HttpResponse.json(douyinConfig)),
      http.post("/api/analytics/refresh", () =>
        HttpResponse.json(
          {
            error: "Your Douyin session expired.",
            errorCode: "collector_relogin",
            collectorCode: "NOT_LOGGED_IN",
          },
          { status: 401 },
        ),
      ),
    );
    renderPanel();

    const refreshBtn = await screen.findByRole("button", { name: /refresh now|立即同步/i });
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());
    fireEvent.click(refreshBtn);

    // Not a silent empty page: the user is told to log into douyin.com + close
    // their browser, then retry.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/douyin\.com/i);
    expect(alert.textContent).toMatch(/close your browser|重新|登录|close/i);
  });

  it("surfaces a 'run setup' prompt when the managed venv isn't ready (503)", async () => {
    mswServer.use(
      http.get("/api/config", () => HttpResponse.json(douyinConfig)),
      http.post("/api/analytics/refresh", () =>
        HttpResponse.json(
          {
            error: "Collector dependencies aren't installed yet.",
            errorCode: "collector_not_ready",
          },
          { status: 503 },
        ),
      ),
    );
    renderPanel();

    const refreshBtn = await screen.findByRole("button", { name: /refresh now|立即同步/i });
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());
    fireEvent.click(refreshBtn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/autoviral setup|安装/i);
  });
});
