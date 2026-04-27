import { Glass } from "@/ui/Glass";
import { ThemeSection } from "./ThemeSection";
import { DensitySection } from "./DensitySection";
import { LayerSection } from "./LayerSection";
import { CompositionSection } from "./CompositionSection";

export function TweaksPanel() {
  return (
    <Glass
      tone="lo"
      style={{
        height: "100%",
        overflowY: "auto",
        borderRadius: 0,
      }}
    >
      <ThemeSection />
      <DensitySection />
      <LayerSection />
      <CompositionSection />
    </Glass>
  );
}
