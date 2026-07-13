import { useEffect } from "react";
import { SettingsPanel } from "./SettingsPanel";
import { useSettingsPanelStore } from "@/stores/settings";

/** Application-level settings host, independent from whichever page header is visible. */
export function GlobalSettingsHost() {
  const openPanel = useSettingsPanelStore((state) => state.openPanel);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        openPanel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  return <SettingsPanel />;
}
