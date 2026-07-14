import { describe, it, expect } from "vitest";
import { MESSAGES } from "./messages";
import { TRANSITION_PRESETS, TRANSITION_PRESET_META } from "@shared/transitions";

// PRD-0014 S2 review fix (finding 1) — registry ⇄ i18n sweep gate.
//
// The transition PICKER (Inspector/TransitionPanel.tsx) renders one <option>
// per registry preset via `t(`studio.transition.preset.${p}`)` and one
// <optgroup> per family via `t(`studio.transition.family.${fam}`)`. Both calls
// carry an `as MessageKey` cast (template literals can't be strict-typed), so a
// preset added to the shared registry (src/shared/transitions.ts) WITHOUT a
// matching message row compiles clean — then renders its BARE KEY in the
// dropdown at runtime, because useT's walk() surfaces the key on a miss
// ("studio.transition.preset.glitch"). That is exactly how the six S2 presets
// (glitch / light-leak / whip-pan-left / whip-pan-right / zoom-in / zoom-out)
// shipped untranslated. This sweep binds the registry to the message tables so
// the next preset addition fails loud in CI, not silently in the UI.
describe("transition i18n sweep — every registry preset + family is translated", () => {
  for (const locale of ["en", "zh"] as const) {
    const presetTable = MESSAGES[locale].studio.transition.preset as Record<
      string,
      string
    >;
    const familyTable = MESSAGES[locale].studio.transition.family as Record<
      string,
      string
    >;

    it.each([...TRANSITION_PRESETS])(
      `[${locale}] preset "%s" has a real, non-bare-key label`,
      (preset) => {
        const label = presetTable[preset];
        expect(label, `missing ${locale} studio.transition.preset.${preset}`).toBeTruthy();
        // A miss in useT returns the dotted key itself — the failure mode we guard.
        expect(label).not.toBe(`studio.transition.preset.${preset}`);
      },
    );

    it(`[${locale}] every family referenced by the registry has a real label`, () => {
      const families = new Set(
        TRANSITION_PRESETS.map((p) => TRANSITION_PRESET_META[p].family),
      );
      for (const fam of families) {
        const label = familyTable[fam];
        expect(label, `missing ${locale} studio.transition.family.${fam}`).toBeTruthy();
        expect(label).not.toBe(`studio.transition.family.${fam}`);
      }
    });
  }
});
