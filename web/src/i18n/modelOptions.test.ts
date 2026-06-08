import { describe, it, expect } from "vitest";
import { MESSAGES } from "./messages";

// Regression guard for the model-tier dropdown copy.
//
// The chat ModelSwitcher (Chat/panels/ModelSwitcher.tsx) deliberately shows
// ONLY the tier name — "Opus" / "Sonnet" — because the config stores a bare
// alias that claude-cli resolves to the LATEST member of that family at spawn
// time. Pinning a version ("Claude Opus · 4.7") is a lie that goes stale every
// release: a user on 4.8 would see "4.7" in Settings. The Settings dropdown
// (SettingsPanel) once hardcoded the version and drifted exactly this way.
//
// This test fails if anyone re-introduces a version number into the dropdown
// option labels, so the Settings copy can never silently lie about the model
// version again. The accompanying note (modelAliasNote) is allowed to mention
// versions — it explains WHY no number is shown.
const VERSION_LIKE = /\d+\.\d+|·\s*\d/;

describe("model-tier option labels carry NO pinned version number", () => {
  for (const locale of ["en", "zh"] as const) {
    const s = MESSAGES[locale].settings;

    it(`${locale}: Opus option has no version`, () => {
      expect(s.field.modelOptionOpus).not.toMatch(VERSION_LIKE);
      expect(s.field.modelOptionOpus).toContain("Opus");
    });

    it(`${locale}: Sonnet option has no version`, () => {
      expect(s.field.modelOptionSonnet).not.toMatch(VERSION_LIKE);
      expect(s.field.modelOptionSonnet).toContain("Sonnet");
    });

    it(`${locale}: Haiku option has no version`, () => {
      expect(s.field.modelOptionHaiku).not.toMatch(VERSION_LIKE);
      expect(s.field.modelOptionHaiku).toContain("Haiku");
    });
  }
});
