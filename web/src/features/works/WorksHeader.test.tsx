import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorksHeader } from "./WorksHeader";
import { useLocaleStore } from "@/i18n/store";
import { useTheme } from "@/stores/theme";
import { useSettingsPanelStore } from "@/stores/settings";

function mount() {
  return render(
    <MemoryRouter>
      <WorksHeader />
    </MemoryRouter>,
  );
}

describe("<WorksHeader />", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useTheme.setState({ theme: "dark" });
    useSettingsPanelStore.setState({ open: false, focusSection: null });
  });

  afterEach(() => {
    delete window.autoviralDesktop;
  });

  it("shows the brand and global controls, which update their stores", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getByRole("link", { name: "Autoviral" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Locale toggle" })).toBeInTheDocument();
    const themeButton = screen.getByRole("button", { name: "Switch to light theme" });
    const settingsButton = screen.getByRole("button", { name: "Global settings" });

    await user.click(screen.getByTestId("locale-toggle-zh"));
    expect(useLocaleStore.getState().locale).toBe("zh");

    await user.click(themeButton);
    expect(useTheme.getState().theme).toBe("light");

    await user.click(settingsButton);
    expect(useSettingsPanelStore.getState().open).toBe(true);
  });

  it("makes the macOS desktop header draggable while controls stay clickable", () => {
    Object.defineProperty(window, "autoviralDesktop", {
      configurable: true,
      value: { isDesktop: true, platform: "darwin" },
    });
    mount();

    expect(
      getComputedStyle(screen.getByTestId("works-header-surface"))
        .getPropertyValue("-webkit-app-region"),
    ).toBe("drag");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Global settings" }))
        .getPropertyValue("-webkit-app-region"),
    ).toBe("no-drag");
  });
});
