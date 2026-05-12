import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { TopNav } from "./TopNav";
import { useSettingsPanelStore } from "@/stores/settings";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TopNav />
        <Routes>
          <Route path="*" element={<div />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("<TopNav />", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: false, focusSection: null });
  });

  it("highlights Works tab on /", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /works/i })).toHaveAttribute("aria-current", "page");
  });
  it("also highlights Works tab on /works (the alias route)", () => {
    // Round 1 added /works as an alias to /. The active() helper has to
    // treat both as the same logical destination so the tab still lights
    // up — otherwise direct navigation to /works leaves the user without
    // a "you are here" cue.
    renderAt("/works");
    expect(screen.getByRole("link", { name: /works/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Explore on /explore", () => {
    renderAt("/explore");
    expect(screen.getByRole("link", { name: /explore/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Analytics on /analytics", () => {
    renderAt("/analytics");
    expect(screen.getByRole("link", { name: /analytics/i })).toHaveAttribute("aria-current", "page");
  });

  it("opens SettingsPanel when gear button is clicked", () => {
    renderAt("/");
    const gearBtn = screen.getByRole("button", { name: /settings|设置/i });
    fireEvent.click(gearBtn);
    expect(useSettingsPanelStore.getState().open).toBe(true);
  });

  it("opens SettingsPanel on ⌘ ,", () => {
    renderAt("/");
    fireEvent.keyDown(document, { key: ",", metaKey: true });
    expect(useSettingsPanelStore.getState().open).toBe(true);
  });

  // R119 F560 — EN locale must render pure-EN nav labels, not the legacy
  // "Works · 作品" bilingual stripes (which silently rendered 44% Chinese
  // chars to EN-locale users). Tests default to EN locale via the global
  // __AUTOVIRAL_LOCALE__ override, so this assertion lands on the EN catalog.
  it("EN locale renders pure-English nav labels with no Chinese suffix (F560)", () => {
    renderAt("/");
    const works = screen.getByRole("link", { name: /works/i });
    const explore = screen.getByRole("link", { name: /explore/i });
    const analytics = screen.getByRole("link", { name: /analytics/i });
    // Exact text — no " · 作品" / " · 灵感" / " · 数据" suffix.
    expect(works.textContent).toBe("Works");
    expect(explore.textContent).toBe("Explore");
    expect(analytics.textContent).toBe("Analytics");
    // Triple-check no CJK chars leaked into the EN block.
    for (const el of [works, explore, analytics]) {
      expect(el.textContent ?? "").not.toMatch(/[一-鿿]/);
    }
  });
});
