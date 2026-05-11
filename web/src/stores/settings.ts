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
