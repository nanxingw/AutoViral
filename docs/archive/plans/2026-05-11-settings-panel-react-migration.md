# Settings Panel React Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the dropped `SettingsPanel.svelte` (last seen on `main-legacy`) to a React right-slide overlay accessible from TopNav `⚙️`, restoring the ability to configure API keys, research cron, Douyin URL binding, and Claude default model — and add a new `Refresh now` action that wraps `analytics-collector.ts:collectData()`.

**Architecture:** A 480px right-slide overlay glass panel, opened via a new zustand store (`useSettingsPanelStore`). Reuses the already-live `GET/PUT /api/config` endpoints (Hono routes at `src/server/api.ts:117-156`). Adds one new endpoint `POST /api/analytics/refresh` that calls the existing `collectData()` function in `src/analytics-collector.ts:48`. All state via TanStack Query + zustand; no new dependencies. A11y via the existing `useModalFocus` hook (`web/src/hooks/useModalFocus.ts`, introduced in R41).

**Tech Stack:** React 18 · Vite · TanStack Query · zustand · CSS Modules · Vitest + Testing Library; Hono on the Node backend.

**Spec reference:** `docs/superpowers/specs/2026-05-11-works-delete-and-channel-analytics-design.md` §3

---

## File Structure

**Create:**
- `src/server/__tests__/analytics-refresh.test.ts` — backend endpoint test
- `web/src/stores/settings.ts` — zustand store: `{ open, focusSection }`
- `web/src/queries/config.ts` — `useConfig`, `useSaveConfig`, `useRefreshAnalytics`
- `web/src/features/settings/SettingsPanel.tsx` — main panel (all 5 sections inline; split later if grows)
- `web/src/features/settings/SettingsPanel.module.css` — slide-in + glass + section styles
- `web/src/features/settings/SettingsPanel.test.tsx` — full panel behavior tests

**Modify:**
- `src/server/api.ts` — add `POST /api/analytics/refresh`
- `web/src/ui/TopNav.tsx` — add `⚙️` button + `⌘ ,` shortcut + mount `<SettingsPanel />`
- `web/src/ui/TopNav.module.css` — gear button styling
- `web/src/i18n/messages.ts` — ~15 new keys
- `web/src/App.tsx` (or wherever toast/portals mount) — ensure `<SettingsPanel />` is mounted at app root if not via TopNav

---

## Task 1: Backend — `POST /api/analytics/refresh` endpoint

**Files:**
- Modify: `src/server/api.ts`
- Modify: `src/analytics-collector.ts` (export `collectData` if not already exported)
- Create: `src/server/__tests__/analytics-refresh.test.ts`

- [ ] **Step 1: Verify `collectData` is exported**

Run: `grep -n "export.*collectData\|^async function collectData" src/analytics-collector.ts`
Expected: `collectData` should be exported. If it shows only `async function collectData` (no `export`), proceed to Step 1b. If `export async function collectData`, skip to Step 2.

- [ ] **Step 1b (only if needed): Export `collectData`**

In `src/analytics-collector.ts`, change `async function collectData(douyinUrl: string)` to `export async function collectData(douyinUrl: string)`.

- [ ] **Step 2: Write failing endpoint test**

Create `src/server/__tests__/analytics-refresh.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Hoisted mocks
vi.mock("../../analytics-collector.js", () => ({
  collectData: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
}));

describe("POST /api/analytics/refresh", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("returns 400 when douyinUrl is not configured", async () => {
    const { loadConfig } = await import("../../config.js");
    (loadConfig as any).mockResolvedValue({ analytics: { douyinUrl: "" } });

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("douyin_url_missing");
  });

  it("returns 200 + collectedAt/worksCount on success", async () => {
    const { loadConfig } = await import("../../config.js");
    const { collectData } = await import("../../analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockResolvedValue({
      collected_at: "2026-05-11T08:00:00Z",
      works: [{ aweme_id: "1" }, { aweme_id: "2" }],
    });

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collectedAt).toBe("2026-05-11T08:00:00Z");
    expect(body.worksCount).toBe(2);
  });

  it("returns 500 when collectData fails", async () => {
    const { loadConfig } = await import("../../config.js");
    const { collectData } = await import("../../analytics-collector.js");
    (loadConfig as any).mockResolvedValue({
      analytics: { douyinUrl: "https://www.douyin.com/user/abc" },
    });
    (collectData as any).mockRejectedValue(new Error("python script crashed"));

    const res = await app.request("/api/analytics/refresh", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.errorCode).toBe("collect_failed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:server -- analytics-refresh`
Expected: All 3 tests FAIL with 404 (route does not exist yet).

- [ ] **Step 4: Implement endpoint in `src/server/api.ts`**

Find an appropriate spot near the existing `/api/analytics/creator` routes (around line 354). Add:

```typescript
// POST /api/analytics/refresh — manually trigger a Douyin data collection
apiRoutes.post("/api/analytics/refresh", async (c) => {
  const config = await loadConfig();
  const douyinUrl = config.analytics?.douyinUrl ?? "";
  if (!douyinUrl) {
    return c.json(
      { error: "Douyin URL not configured", errorCode: "douyin_url_missing" },
      400
    );
  }
  try {
    const data = await collectData(douyinUrl);
    if (!data) {
      return c.json(
        { error: "Collection returned no data", errorCode: "collect_failed" },
        500
      );
    }
    return c.json({
      collectedAt: data.collected_at,
      worksCount: data.works.length,
    });
  } catch (err) {
    return c.json(
      { error: String(err), errorCode: "collect_failed" },
      500
    );
  }
});
```

Make sure `collectData` is imported at the top of `api.ts`: check imports near line 1-30, add `import { collectData } from "../analytics-collector.js";` if missing.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server -- analytics-refresh`
Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts src/analytics-collector.ts src/server/__tests__/analytics-refresh.test.ts
git commit -m "feat(api): POST /api/analytics/refresh wraps collectData for manual trigger"
```

---

## Task 2: Frontend — `useSettingsPanelStore` zustand store

**Files:**
- Create: `web/src/stores/settings.ts`

- [ ] **Step 1: Read existing zustand pattern**

Run: `head -30 web/src/stores/theme.ts`
Read the pattern. The store should follow the same conventions (`create()` with `set`, no `persist` middleware for this case since panel state is ephemeral).

- [ ] **Step 2: Write the store**

Create `web/src/stores/settings.ts`:

```typescript
import { create } from "zustand";

export type SettingsFocusSection = "jimeng" | "openrouter" | "research" | "douyin" | "model" | null;

interface SettingsPanelState {
  open: boolean;
  focusSection: SettingsFocusSection;
  openPanel: (focusSection?: SettingsFocusSection) => void;
  closePanel: () => void;
  clearFocus: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  open: false,
  focusSection: null,
  openPanel: (focusSection = null) => set({ open: true, focusSection }),
  closePanel: () => set({ open: false, focusSection: null }),
  clearFocus: () => set({ focusSection: null }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add web/src/stores/settings.ts
git commit -m "feat(settings): zustand store for SettingsPanel open + focus section"
```

---

## Task 3: Frontend — config + refresh queries

**Files:**
- Create: `web/src/queries/config.ts`

- [ ] **Step 1: Read existing query module pattern**

Run: `head -40 web/src/queries/analytics.ts; echo '---'; head -40 web/src/queries/works.ts`
Note: `apiFetch` is from `@/lib/api`, queries use `useQuery({ queryKey, queryFn })`, mutations use `useMutation({ mutationFn, onSuccess })` with `qc.invalidateQueries`.

- [ ] **Step 2: Write the queries file**

Create `web/src/queries/config.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AppConfig {
  jimengAccessKey: string;
  jimengSecretKey: string;
  openrouterKey: string;
  douyinUrl: string;
  researchEnabled: boolean;
  researchCron: string;
  model: string;
  // Last analytics collection timestamp (read from latest.json), optional
  analyticsLastCollectedAt?: string | null;
}

export type ConfigPatch = Partial<Omit<AppConfig, "analyticsLastCollectedAt">>;

const CONFIG_QUERY_KEY = ["config"] as const;

export function useConfig() {
  return useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const raw = await apiFetch<Record<string, unknown>>("/api/config");
      return {
        jimengAccessKey: (raw.jimengAccessKey as string) ?? "",
        jimengSecretKey: (raw.jimengSecretKey as string) ?? "",
        openrouterKey: (raw.openrouterKey as string) ?? "",
        douyinUrl: (raw.douyinUrl as string) ?? "",
        researchEnabled: Boolean(raw.researchEnabled ?? (raw as any).research?.enabled ?? false),
        researchCron: (raw.researchCron as string) ?? ((raw as any).research?.schedule as string) ?? "0 9 * * *",
        model: (raw.model as string) ?? "sonnet",
        analyticsLastCollectedAt: (raw.analyticsLastCollectedAt as string) ?? null,
      } satisfies AppConfig;
    },
    staleTime: 60_000,
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ConfigPatch) =>
      apiFetch<AppConfig>("/api/config", { method: "PUT", body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });
}

export interface RefreshResult {
  collectedAt: string;
  worksCount: number;
}

export function useRefreshAnalytics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RefreshResult>("/api/analytics/refresh", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["creator-analytics"] });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/queries/config.ts
git commit -m "feat(settings): useConfig + useSaveConfig + useRefreshAnalytics queries"
```

---

## Task 4: i18n — add settings panel keys

**Files:**
- Modify: `web/src/i18n/messages.ts`

- [ ] **Step 1: Locate the messages map**

Run: `grep -n "topnav.works\|works.menu" web/src/i18n/messages.ts | head -5`
Note the structure (likely a nested object or flat-keyed `Record<string, { zh, en }>`).

- [ ] **Step 2: Add 15 keys**

Add the following entries (adapt to whichever shape the file uses):

| Key | en | zh |
|---|---|---|
| `topnav.settings` | `Settings` | `设置` |
| `settings.title` | `Settings` | `设置` |
| `settings.close` | `Close settings` | `关闭设置` |
| `settings.section.jimeng` | `Jimeng API` | `即梦 API` |
| `settings.section.openrouter` | `OpenRouter API` | `OpenRouter API` |
| `settings.section.research` | `Research` | `调研设置` |
| `settings.section.douyin` | `Douyin channel` | `抖音号绑定` |
| `settings.section.model` | `Default model` | `默认模型` |
| `settings.field.accessKey` | `AccessKey` | `AccessKey` |
| `settings.field.secretKey` | `SecretKey` | `SecretKey` |
| `settings.field.apiKey` | `API Key` | `API Key` |
| `settings.field.douyinUrl` | `Profile URL` | `主页 URL` |
| `settings.field.cron` | `Cron schedule` | `Cron 表达式` |
| `settings.field.autoResearch` | `Enable scheduled research` | `启用自动调研` |
| `settings.show` | `Show` | `显示` |
| `settings.hide` | `Hide` | `隐藏` |
| `settings.save` | `Save changes` | `保存` |
| `settings.cancel` | `Cancel` | `取消` |
| `settings.refresh` | `Refresh now` | `立即抓取` |
| `settings.refreshing` | `Refreshing… (~30s)` | `抓取中… (~30s)` |
| `settings.lastCollected` | `Last collected` | `上次抓取` |
| `settings.viaEnv` | `via .env` | `来自 .env` |
| `settings.unsavedTitle` | `Discard unsaved changes?` | `放弃未保存修改？` |
| `settings.unsavedBody` | `Your changes will be lost.` | `你的修改将会丢失。` |
| `settings.unsavedConfirm` | `Discard` | `放弃` |

(That's 25 keys; the 15 was a rough estimate — actual is ~25 because of save/cancel/unsaved sub-flows. All are user-facing strings, none optional.)

- [ ] **Step 3: Run i18n tests**

Run: `npm run test:web -- i18n`
Expected: PASS (or no i18n-specific tests; that's fine — just confirm no compile error).

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/messages.ts
git commit -m "feat(settings): add 25 i18n keys for SettingsPanel"
```

---

## Task 5: SettingsPanel skeleton — overlay + a11y + escape

**Files:**
- Create: `web/src/features/settings/SettingsPanel.tsx`
- Create: `web/src/features/settings/SettingsPanel.module.css`
- Create: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Read existing modal pattern**

Run: `head -80 web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.tsx; echo '---'; cat web/src/hooks/useModalFocus.ts`
Note how `useModalFocus` is wired and how the overlay handles escape/click-outside.

- [ ] **Step 2: Write failing skeleton test**

Create `web/src/features/settings/SettingsPanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:web -- SettingsPanel`
Expected: FAIL with "SettingsPanel not found".

- [ ] **Step 4: Implement the skeleton**

Create `web/src/features/settings/SettingsPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import styles from "./SettingsPanel.module.css";

export function SettingsPanel() {
  const open = useSettingsPanelStore((s) => s.open);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useModalFocus(open, panelRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        ref={panelRef}
      >
        <header className={styles.header}>
          <h2>{t("settings.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t("settings.close")}
            onClick={closePanel}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          {/* Sections added in Task 6+ */}
        </div>
      </div>
    </div>
  );
}
```

Create `web/src/features/settings/SettingsPanel.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 100;
  animation: fade 200ms ease-out;
}
.panel {
  width: 480px;
  max-width: 90vw;
  height: 100%;
  background: var(--surface-1);
  border-left: 1px solid var(--glass-border);
  backdrop-filter: blur(24px) saturate(140%);
  display: flex;
  flex-direction: column;
  animation: slide 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.header {
  padding: 24px 28px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--glass-border);
}
.header h2 {
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  margin: 0;
}
.closeBtn {
  background: transparent;
  border: 0;
  font-size: 22px;
  cursor: pointer;
  color: var(--text-dim);
  padding: 4px 8px;
}
.closeBtn:hover { color: var(--text); }
.body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
@keyframes fade {
  from { opacity: 0; } to { opacity: 1; }
}
@keyframes slide {
  from { transform: translateX(100%); } to { transform: translateX(0); }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:web -- SettingsPanel`
Expected: All 4 skeleton tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/settings/
git commit -m "feat(settings): SettingsPanel overlay skeleton with esc/backdrop close + a11y focus"
```

---

## Task 6: Sections — Jimeng + OpenRouter (password fields)

**Files:**
- Modify: `web/src/features/settings/SettingsPanel.tsx`
- Modify: `web/src/features/settings/SettingsPanel.module.css`
- Modify: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing tests for key sections**

Append to `SettingsPanel.test.tsx`:

```tsx
describe("SettingsPanel — Jimeng + OpenRouter sections", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: true, focusSection: null });
  });

  it("loads and renders config fields", async () => {
    // Mock /api/config response via msw or fetch mock
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
        }));
      }
      return new Response("{}");
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
    }))));
    renderPanel();
    const ak = await screen.findByDisplayValue("AK123") as HTMLInputElement;
    expect(ak.type).toBe("password");
    const toggleBtn = screen.getAllByRole("button", { name: /show|显示/i })[0];
    fireEvent.click(toggleBtn);
    expect(ak.type).toBe("text");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:web -- SettingsPanel`
Expected: New 2 tests FAIL ("not found AK123" etc).

- [ ] **Step 3: Implement Jimeng + OpenRouter sections**

In `SettingsPanel.tsx`, replace the empty `<div className={styles.body}>` with a full body that uses `useConfig()` and renders both sections. Update the file:

```tsx
import { useEffect, useRef, useState } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import { useConfig, useSaveConfig, type AppConfig } from "@/queries/config";
import styles from "./SettingsPanel.module.css";

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  showLabel: string;
  hideLabel: string;
}
function SecretField({ label, value, onChange, showLabel, hideLabel }: SecretFieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldRow}>
        <input
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={styles.input}
        />
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? hideLabel : showLabel}
        </button>
      </div>
    </label>
  );
}

export function SettingsPanel() {
  const open = useSettingsPanelStore((s) => s.open);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { data: config } = useConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);

  useModalFocus(open, panelRef);

  // Seed draft when config loads / panel opens
  useEffect(() => {
    if (open && config && !draft) setDraft({ ...config });
    if (!open) setDraft(null);
  }, [open, config, draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  if (!open || !draft) {
    return open ? (
      <div className={styles.backdrop} data-testid="settings-backdrop" onClick={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-label={t("settings.title")} ref={panelRef}>
          <div className={styles.body}>Loading…</div>
        </div>
      </div>
    ) : null;
  }

  const patch = (k: keyof AppConfig, v: any) => setDraft({ ...draft, [k]: v });

  return (
    <div
      className={styles.backdrop}
      data-testid="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        ref={panelRef}
      >
        <header className={styles.header}>
          <h2>{t("settings.title")}</h2>
          <button type="button" className={styles.closeBtn} aria-label={t("settings.close")} onClick={closePanel}>×</button>
        </header>
        <div className={styles.body}>
          <section data-section="jimeng">
            <h3 className={styles.sectionLabel}>{t("settings.section.jimeng")}</h3>
            <SecretField
              label={t("settings.field.accessKey")}
              value={draft.jimengAccessKey}
              onChange={(v) => patch("jimengAccessKey", v)}
              showLabel={t("settings.show")}
              hideLabel={t("settings.hide")}
            />
            <SecretField
              label={t("settings.field.secretKey")}
              value={draft.jimengSecretKey}
              onChange={(v) => patch("jimengSecretKey", v)}
              showLabel={t("settings.show")}
              hideLabel={t("settings.hide")}
            />
          </section>

          <section data-section="openrouter">
            <h3 className={styles.sectionLabel}>{t("settings.section.openrouter")}</h3>
            <SecretField
              label={t("settings.field.apiKey")}
              value={draft.openrouterKey}
              onChange={(v) => patch("openrouterKey", v)}
              showLabel={t("settings.show")}
              hideLabel={t("settings.hide")}
            />
          </section>

          {/* Research, Douyin, Model sections added in Tasks 7-9 */}
        </div>
      </div>
    </div>
  );
}
```

Append CSS to `SettingsPanel.module.css`:

```css
.sectionLabel {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin: 0 0 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.fieldLabel {
  font-size: 12px;
  color: var(--text-dim);
}
.fieldRow {
  display: flex;
  gap: 6px;
}
.input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font: inherit;
  color: var(--text);
}
.input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.toggleBtn {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:web -- SettingsPanel`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/
git commit -m "feat(settings): Jimeng + OpenRouter sections with password reveal"
```

---

## Task 7: Section — Research (toggle + cron)

**Files:**
- Modify: `web/src/features/settings/SettingsPanel.tsx`
- Modify: `web/src/features/settings/SettingsPanel.module.css`
- Modify: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `SettingsPanel.test.tsx`:

```tsx
it("renders research toggle + cron input", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
    douyinUrl: "", researchEnabled: true, researchCron: "0 9 * * *", model: "sonnet",
  }))));
  useSettingsPanelStore.setState({ open: true, focusSection: null });
  renderPanel();
  expect(await screen.findByRole("switch")).toBeChecked();
  expect(screen.getByDisplayValue("0 9 * * *")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- SettingsPanel`
Expected: New test FAILS.

- [ ] **Step 3: Add the section**

In `SettingsPanel.tsx`, after the OpenRouter section, add:

```tsx
<section data-section="research">
  <h3 className={styles.sectionLabel}>{t("settings.section.research")}</h3>
  <label className={styles.toggleRow}>
    <span>{t("settings.field.autoResearch")}</span>
    <button
      type="button"
      role="switch"
      aria-checked={draft.researchEnabled}
      className={styles.toggle}
      data-on={draft.researchEnabled}
      onClick={() => patch("researchEnabled", !draft.researchEnabled)}
    >
      <span className={styles.toggleThumb} />
    </button>
  </label>
  {draft.researchEnabled && (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{t("settings.field.cron")}</span>
      <input
        className={styles.input}
        value={draft.researchCron}
        onChange={(e) => patch("researchCron", e.target.value)}
      />
    </label>
  )}
</section>
```

Append CSS:

```css
.toggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 12px;
}
.toggle {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--surface-2);
  position: relative;
  cursor: pointer;
  transition: background 200ms;
}
.toggle[data-on="true"] { background: var(--accent); }
.toggleThumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text);
  transition: transform 200ms;
}
.toggle[data-on="true"] .toggleThumb { transform: translateX(16px); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:web -- SettingsPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/
git commit -m "feat(settings): research section — auto toggle + cron input"
```

---

## Task 8: Section — Douyin binding + Refresh now + Last collected

**Files:**
- Modify: `web/src/features/settings/SettingsPanel.tsx`
- Modify: `web/src/features/settings/SettingsPanel.module.css`
- Modify: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `SettingsPanel.test.tsx`:

```tsx
it("triggers refresh on Refresh now click", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/config")) {
      return new Response(JSON.stringify({
        jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "https://www.douyin.com/user/abc",
        researchEnabled: false, researchCron: "", model: "sonnet",
        analyticsLastCollectedAt: "2026-05-09T09:00:00Z",
      }));
    }
    if (url.includes("/api/analytics/refresh") && init?.method === "POST") {
      return new Response(JSON.stringify({ collectedAt: "2026-05-11T08:00:00Z", worksCount: 42 }));
    }
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
  useSettingsPanelStore.setState({ open: true, focusSection: null });
  renderPanel();

  const refreshBtn = await screen.findByRole("button", { name: /refresh now|立即抓取/i });
  fireEvent.click(refreshBtn);
  await screen.findByText(/refreshing|抓取中/i);
  await screen.findByText(/last collected|上次抓取/i);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/analytics/refresh"),
    expect.objectContaining({ method: "POST" })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- SettingsPanel`
Expected: FAIL.

- [ ] **Step 3: Add the section**

In `SettingsPanel.tsx`, import `useRefreshAnalytics` and add the section after Research:

```tsx
import { useConfig, useSaveConfig, useRefreshAnalytics, type AppConfig } from "@/queries/config";
// ...
const refreshMut = useRefreshAnalytics();
// ...inside the body:
<section data-section="douyin" id="douyin-binding">
  <h3 className={styles.sectionLabel}>{t("settings.section.douyin")}</h3>
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{t("settings.field.douyinUrl")}</span>
    <input
      className={styles.input}
      value={draft.douyinUrl}
      onChange={(e) => patch("douyinUrl", e.target.value)}
      placeholder="https://www.douyin.com/user/..."
    />
  </label>
  <div className={styles.refreshRow}>
    <button
      type="button"
      className={styles.refreshBtn}
      disabled={!draft.douyinUrl || refreshMut.isPending}
      onClick={() => refreshMut.mutate()}
    >
      {refreshMut.isPending ? t("settings.refreshing") : t("settings.refresh")}
    </button>
    {draft.analyticsLastCollectedAt && (
      <span className={styles.lastCollected}>
        {t("settings.lastCollected")}: {new Date(draft.analyticsLastCollectedAt).toLocaleString()}
      </span>
    )}
  </div>
</section>
```

Append CSS:

```css
.refreshRow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.refreshBtn {
  background: var(--accent);
  color: var(--bg);
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  font-size: 12px;
  cursor: pointer;
}
.refreshBtn:disabled { opacity: 0.5; cursor: not-allowed; }
.lastCollected {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-dim);
}
```

- [ ] **Step 4: Surface `analyticsLastCollectedAt` from the backend**

Modify `src/server/api.ts` GET `/api/config` to read `latest.json` and include `analyticsLastCollectedAt`. Around line 117:

```typescript
apiRoutes.get("/api/config", async (c) => {
  const config = await loadConfig();
  let analyticsLastCollectedAt: string | null = null;
  try {
    const latestPath = join(homedir(), ".autoviral", "analytics", "douyin", "latest.json");
    const raw = await readFile(latestPath, "utf-8");
    const parsed = JSON.parse(raw);
    analyticsLastCollectedAt = parsed.collected_at ?? null;
  } catch { /* file may not exist */ }
  return c.json({
    ...config,
    jimengAccessKey: config.jimeng?.accessKey ?? "",
    jimengSecretKey: config.jimeng?.secretKey ?? "",
    openrouterKey: config.openrouter?.apiKey ?? "",
    douyinUrl: config.analytics?.douyinUrl ?? "",
    memorySyncEnabled: config.memory?.syncEnabled ?? false,
    researchEnabled: config.research?.enabled ?? false,
    researchCron: config.research?.schedule ?? "0 9 * * *",
    analyticsLastCollectedAt,
  });
});
```

Ensure `readFile`, `join`, `homedir` imports exist at the top of `api.ts`. They likely do; check before editing.

- [ ] **Step 5: Run tests**

Run: `npm run test:web -- SettingsPanel && npm run test:server -- config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/settings/ src/server/api.ts
git commit -m "feat(settings): Douyin section with URL + Refresh now + Last collected"
```

---

## Task 9: Section — Default model

**Files:**
- Modify: `web/src/features/settings/SettingsPanel.tsx`
- Modify: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing test**

Append:

```tsx
it("renders model select", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    jimengAccessKey: "", jimengSecretKey: "", openrouterKey: "",
    douyinUrl: "", researchEnabled: false, researchCron: "", model: "opus",
  }))));
  useSettingsPanelStore.setState({ open: true, focusSection: null });
  renderPanel();
  const select = await screen.findByLabelText(/default model|默认模型/i) as HTMLSelectElement;
  expect(select.value).toBe("opus");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- SettingsPanel`
Expected: FAIL.

- [ ] **Step 3: Add the section**

After Douyin section:

```tsx
<section data-section="model">
  <h3 className={styles.sectionLabel}>{t("settings.section.model")}</h3>
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{t("settings.section.model")}</span>
    <select
      className={styles.input}
      value={draft.model}
      onChange={(e) => patch("model", e.target.value)}
      aria-label={t("settings.section.model")}
    >
      <option value="opus">Claude Opus</option>
      <option value="sonnet">Claude Sonnet</option>
      <option value="haiku">Claude Haiku</option>
    </select>
  </label>
</section>
```

- [ ] **Step 4: Run tests**

Run: `npm run test:web -- SettingsPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/SettingsPanel.tsx web/src/features/settings/SettingsPanel.test.tsx
git commit -m "feat(settings): default model selector"
```

---

## Task 10: Save / Cancel + dirty-state UnsavedChangesConfirm

**Files:**
- Modify: `web/src/features/settings/SettingsPanel.tsx`
- Modify: `web/src/features/settings/SettingsPanel.module.css`
- Modify: `web/src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Add failing tests**

Append:

```tsx
it("saves config on Save click", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/config") && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({
        jimengAccessKey: "old", jimengSecretKey: "", openrouterKey: "",
        douyinUrl: "", researchEnabled: false, researchCron: "", model: "sonnet",
      }));
    }
    if (url.includes("/api/config") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
  useSettingsPanelStore.setState({ open: true, focusSection: null });
  renderPanel();
  const ak = await screen.findByDisplayValue("old") as HTMLInputElement;
  fireEvent.change(ak, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /save|保存/i }));
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/config"),
      expect.objectContaining({ method: "PUT" })
    );
  });
});

it("warns on Escape with dirty changes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    jimengAccessKey: "old", jimengSecretKey: "", openrouterKey: "",
    douyinUrl: "", researchEnabled: false, researchCron: "", model: "sonnet",
  }))));
  useSettingsPanelStore.setState({ open: true, focusSection: null });
  renderPanel();
  const ak = await screen.findByDisplayValue("old") as HTMLInputElement;
  fireEvent.change(ak, { target: { value: "new" } });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(useSettingsPanelStore.getState().open).toBe(true);
  expect(screen.getByText(/discard unsaved|放弃未保存/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:web -- SettingsPanel`
Expected: FAIL.

- [ ] **Step 3: Implement footer + dirty check**

Add to `SettingsPanel.tsx`:

```tsx
const saveMut = useSaveConfig();
const [showUnsaved, setShowUnsaved] = useState(false);

const isDirty = config && draft && JSON.stringify({
  jimengAccessKey: config.jimengAccessKey, jimengSecretKey: config.jimengSecretKey,
  openrouterKey: config.openrouterKey, douyinUrl: config.douyinUrl,
  researchEnabled: config.researchEnabled, researchCron: config.researchCron, model: config.model,
}) !== JSON.stringify({
  jimengAccessKey: draft.jimengAccessKey, jimengSecretKey: draft.jimengSecretKey,
  openrouterKey: draft.openrouterKey, douyinUrl: draft.douyinUrl,
  researchEnabled: draft.researchEnabled, researchCron: draft.researchCron, model: draft.model,
});

const requestClose = () => {
  if (isDirty) setShowUnsaved(true);
  else closePanel();
};

// Replace existing Escape handler:
useEffect(() => {
  if (!open) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") requestClose();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [open, isDirty]);

// Replace backdrop onClick:
onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}

// Footer (after body div, before closing panel div):
<footer className={styles.footer}>
  <button type="button" className={styles.btnGhost} onClick={requestClose}>
    {t("settings.cancel")}
  </button>
  <button
    type="button"
    className={styles.btnPrimary}
    disabled={!isDirty || saveMut.isPending}
    onClick={() => {
      if (!draft) return;
      saveMut.mutate({
        jimengAccessKey: draft.jimengAccessKey,
        jimengSecretKey: draft.jimengSecretKey,
        openrouterKey: draft.openrouterKey,
        douyinUrl: draft.douyinUrl,
        researchEnabled: draft.researchEnabled,
        researchCron: draft.researchCron,
        model: draft.model,
      }, { onSuccess: () => closePanel() });
    }}
  >
    {saveMut.isPending ? "…" : t("settings.save")}
  </button>
</footer>

// UnsavedChangesConfirm at the end:
{showUnsaved && (
  <div className={styles.confirmBackdrop} onClick={() => setShowUnsaved(false)}>
    <div className={styles.confirmBox} role="alertdialog" onClick={(e) => e.stopPropagation()}>
      <h3>{t("settings.unsavedTitle")}</h3>
      <p>{t("settings.unsavedBody")}</p>
      <div className={styles.confirmActions}>
        <button type="button" className={styles.btnGhost} onClick={() => setShowUnsaved(false)}>
          {t("settings.cancel")}
        </button>
        <button type="button" className={styles.btnDanger} onClick={() => { setShowUnsaved(false); closePanel(); }}>
          {t("settings.unsavedConfirm")}
        </button>
      </div>
    </div>
  </div>
)}
```

Append CSS:

```css
.footer {
  padding: 16px 28px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btnGhost {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  cursor: pointer;
  color: var(--text);
}
.btnPrimary {
  background: var(--accent);
  color: var(--bg);
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  cursor: pointer;
}
.btnPrimary:disabled { opacity: 0.5; cursor: not-allowed; }
.btnDanger {
  background: var(--danger, #c44a4a);
  color: white;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  cursor: pointer;
}
.confirmBackdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: grid;
  place-items: center;
}
.confirmBox {
  background: var(--surface-1);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 24px;
  max-width: 360px;
}
.confirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:web -- SettingsPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/settings/
git commit -m "feat(settings): Save/Cancel footer + dirty-state UnsavedChangesConfirm"
```

---

## Task 11: TopNav integration — ⚙️ button + ⌘ , shortcut + mount

**Files:**
- Modify: `web/src/ui/TopNav.tsx`
- Modify: `web/src/ui/TopNav.module.css`

- [ ] **Step 1: Read TopNav structure**

Run: `cat web/src/ui/TopNav.tsx`
Note where `ThemeToggle` and `LocaleToggle` are mounted; add `⚙️` next to them.

- [ ] **Step 2: Add ⚙️ button + shortcut + mount**

In `TopNav.tsx`:

```tsx
import { useEffect } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
// ...

export function TopNav() {
  // ... existing
  const openPanel = useSettingsPanelStore((s) => s.openPanel);
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openPanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPanel]);

  return (
    <>
      <header className={styles.outer}>
        <Glass className={styles.inner}>
          {/* ... existing brand + tabs ... */}
          <div className={styles.actions}>
            {/* ... existing search? + LocaleToggle + ThemeToggle ... */}
            <button
              type="button"
              className={styles.gearBtn}
              aria-label={t("topnav.settings")}
              onClick={() => openPanel()}
            >
              <GearIcon />
            </button>
          </div>
        </Glass>
      </header>
      <SettingsPanel />
    </>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
```

If TopNav.tsx does not yet have an `.actions` wrapper, wrap the existing ThemeToggle / LocaleToggle in `<div className={styles.actions}>`. Confirm by reading file.

- [ ] **Step 3: Add CSS for gear button**

In `TopNav.module.css`:

```css
.gearBtn {
  background: transparent;
  border: 0;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
}
.gearBtn:hover { color: var(--text); background: var(--surface-2); }
.gearBtn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Verify by running tests**

Run: `npm run test:web -- TopNav SettingsPanel`
Expected: PASS. (Existing TopNav tests must still pass.)

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/TopNav.tsx web/src/ui/TopNav.module.css
git commit -m "feat(topnav): mount SettingsPanel + ⚙️ button + ⌘, shortcut"
```

---

## Task 12: E2E browser verification (required per project rule)

Per `.claude/rules/e2e-testing.md`: backend ✓ + tests ✓ does NOT mean feature is shipped. The only acceptance signal is a browser screenshot showing the feature working from the user's perspective.

- [ ] **Step 1: Start dev server**

Run: `npm run dev` (background)
Wait until ready (`http://localhost:5173` or similar — check terminal output).

- [ ] **Step 2: Open browser + screenshot baseline**

Open browser via `mcp__claude-in-chrome__tabs_create_mcp` at the homepage. Screenshot — confirm `⚙️` button is visible in TopNav.

- [ ] **Step 3: Click ⚙️ → screenshot the panel open**

Confirm:
- Panel slides in from right
- All 5 sections visible (Jimeng, OpenRouter, Research, Douyin, Default model)
- Save button disabled (no dirty state)

- [ ] **Step 4: Edit a field → screenshot**

Type in the Douyin URL field. Confirm:
- Save button becomes enabled
- Refresh now button enables when URL is non-empty

- [ ] **Step 5: Test Escape with dirty state → screenshot**

Press Escape. Confirm UnsavedChangesConfirm appears.

- [ ] **Step 6: Cancel the confirm → Click Save → screenshot**

Confirm panel closes, no error toast.

- [ ] **Step 7: Reopen, verify persisted**

Press ⌘ , (or click ⚙️). Confirm the saved URL is shown.

- [ ] **Step 8: Final commit**

```bash
git commit --allow-empty -m "chore(settings): E2E verified — panel open/save/refresh/dirty all working"
```

---

## Definition of Done

- [ ] All 11 implementation tasks committed with passing tests
- [ ] `npm run test:web` exits 0
- [ ] `npm run test:server` exits 0
- [ ] Browser screenshots captured for steps 2–7 of Task 12
- [ ] No new files added to `docs/superpowers/` (per user preference — spec/plan stay local)

## Non-goals (reaffirmed)

- ❌ Memory sync UI
- ❌ Multi-platform binding (Xiaohongshu / B站)
- ❌ Real-time validation of Cron expression (browser-side parser) — accept any string, server-side cron lib will validate at run time
- ❌ OAuth-based Douyin binding — manual URL paste only
- ❌ `via .env` override indicator badge — spec mentioned it, but legacy svelte impl also did not have it, and `loadConfig()` already silently env-overrides which can confuse "save did nothing" users. Tracked as known limitation; revisit if user reports the confusion.
