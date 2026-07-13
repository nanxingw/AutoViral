import { ThemeSection } from "./ThemeSection";
import { PlatformPresetSection } from "./PlatformPresetSection";
import { FpsSection } from "./FpsSection";
import { IconButton } from "@/ui/IconButton";
import { XIcon } from "@/ui/icons";
import { AppPreferencesSection } from "./AppPreferencesSection";

export function TweaksPanel({
  open,
  onClose,
  workId,
}: {
  open: boolean;
  onClose?: () => void;
  workId?: string;
}) {
  if (!open) return null;
  return (
    <aside
      data-testid="tweaks-panel"
      aria-label="Settings"
      style={{
        position: "fixed",
        top: 76,
        right: 14,
        width: 240,
        zIndex: 50,
        background: "var(--surface-1)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: "1px solid var(--glass-border)",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      {onClose ? (
        <IconButton
          size="compact"
          variant="ghost"
          aria-label="Close settings"
          data-testid="tweaks-close"
          onClick={onClose}
          style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        >
          <XIcon width={12} height={12} />
        </IconButton>
      ) : null}
      <ThemeSection />
      <AppPreferencesSection />
      {workId ? <PlatformPresetSection workId={workId} /> : null}
      {workId ? <FpsSection workId={workId} /> : null}
    </aside>
  );
}
