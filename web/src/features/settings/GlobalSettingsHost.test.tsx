import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { GlobalSettingsHost } from "./GlobalSettingsHost";
import { useSettingsPanelStore } from "@/stores/settings";

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GlobalSettingsHost />
    </QueryClientProvider>,
  );
}

describe("GlobalSettingsHost", () => {
  beforeEach(() => {
    useSettingsPanelStore.setState({ open: false, focusSection: null });
  });

  it.each([
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ])("opens settings with Cmd/Ctrl+, independently of page headers", (modifiers) => {
    mount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: ",", ...modifiers });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the opened settings panel with Escape", () => {
    mount();
    fireEvent.keyDown(document, { key: ",", metaKey: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
