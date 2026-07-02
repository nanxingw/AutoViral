import type { Scene } from "@shared/composition";
import type { MessageKey } from "@/i18n/useT";

// Scene (分镜) enum → i18n message-key maps — the SINGLE source shared by the
// ScriptTab storyboard list and the B6 Dive cluster title bars, so status /
// intent / shot / camera copy is identical wherever a scene is summarised
// ("同源", PRD-0010 B6). The data stays in stable code-facing enum literals; the
// UI localises through these maps. Kept in lockstep with SceneSchema.

export const INTENT_KEY: Record<NonNullable<Scene["intent"]>, MessageKey> = {
  hook: "studio.scriptPanel.intentHook",
  build: "studio.scriptPanel.intentBuild",
  payoff: "studio.scriptPanel.intentPayoff",
  cta: "studio.scriptPanel.intentCta",
};

export const STATUS_KEY: Record<Scene["status"], MessageKey> = {
  planned: "studio.scriptPanel.statusPlanned",
  generated: "studio.scriptPanel.statusGenerated",
  stale: "studio.scriptPanel.statusStale",
};

export const SHOT_KEY: Record<NonNullable<Scene["shotSize"]>, MessageKey> = {
  long: "studio.scriptPanel.shotLong",
  full: "studio.scriptPanel.shotFull",
  medium: "studio.scriptPanel.shotMedium",
  close: "studio.scriptPanel.shotClose",
  closeup: "studio.scriptPanel.shotCloseup",
};

export const CAMERA_KEY: Record<NonNullable<Scene["cameraMovement"]>, MessageKey> = {
  push: "studio.scriptPanel.cameraPush",
  pull: "studio.scriptPanel.cameraPull",
  pan: "studio.scriptPanel.cameraPan",
  track: "studio.scriptPanel.cameraTrack",
  follow: "studio.scriptPanel.cameraFollow",
  static: "studio.scriptPanel.cameraStatic",
};

// Whether a status dot is filled (generated / stale) or hollow (planned). stale
// is filled BUT tinted with --status-warn — one of the three channels (colour +
// icon + text) that encode "needs regen" without relying on hue alone.
export const STATUS_FILLED: Record<Scene["status"], boolean> = {
  planned: false,
  generated: true,
  stale: true,
};
