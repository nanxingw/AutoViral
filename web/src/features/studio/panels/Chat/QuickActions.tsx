import { useComposition } from "../../store";
import { useChatSocket } from "@/features/chat/useChatSocket";
import { useT } from "@/i18n/useT";
import { useParams } from "react-router-dom";

export function QuickActions() {
  const sel = useComposition((s) => s.selection);
  const comp = useComposition((s) => s.comp);
  const clip = comp?.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === sel);
  const { workId } = useParams();
  const { send } = useChatSocket(workId ?? null);
  const t = useT();

  // Prompts stay Chinese — the agent's autoviral skill expects Mandarin
  // for short-video flavor. Only labels are i18n'd.
  const actions: {
    label: string;
    prompt: string;
    title?: string;
    disabled?: boolean;
  }[] = [];

  // R45 — always-available creation shortcuts. Pre-fix users had no idea
  // TTS / ASR-caption capabilities existed because the entry was buried
  // inside the GenerationDialog audio sub-tab. These two prompts let
  // users invoke them directly via chat — agent then dispatches internally.
  //
  // e2e-report F149: prompts must read as user-natural speech (M89 朗读 test).
  // Old prompts leaked /api/audio/* endpoints, subtitle_burn.py script names,
  // PYTHON_DEP_MISSING error class, and pip install commands — users felt
  // "the system is impersonating me in chat". Agent skill ecosystem
  // (skills/autoviral/modules/assets + assembly) already handles dispatch
  // from intent; the technical scaffolding belongs in the skill, not the
  // user-visible message bubble.
  //
  // Prompts stay ZH (agent's autoviral skill is Mandarin-tuned for
  // short-video flavor). Only labels and tooltips are i18n'd.
  // F157: "+ 配音" / "+ 字幕" prompts assume a video clip exists on the
  // timeline ("这段视频…"). Firing them against an empty timeline injects
  // an ill-formed task that the agent can't act on but still bills compute
  // for ("思考中…"). Pre-condition gate: disable both when no video clip
  // is on any track. Tooltip explains the gate instead of silently dropping.
  const hasVideoClip = (comp?.tracks ?? []).some((t) =>
    t.clips.some((c) => c.kind === "video"),
  );
  if (workId) {
    actions.push(
      {
        label: t("chat.quickActions.studio.generateNarration"),
        title: hasVideoClip
          ? t("chat.quickActions.studio.narrationLangHint")
          : t("chat.quickActions.studio.needVideoHint"),
        disabled: !hasVideoClip,
        prompt:
          "为当前视频生成一段 30-60 秒中文配音，口语化、有节奏、有钩子，用温暖自然的女声合成并加到音频轨。",
      },
      {
        label: t("chat.quickActions.studio.generateCaptions"),
        title: hasVideoClip
          ? t("chat.quickActions.studio.captionsLangHint")
          : t("chat.quickActions.studio.needVideoHint"),
        disabled: !hasVideoClip,
        prompt:
          "为当前视频识别语音并生成词级时间戳字幕，加到时间轴的字幕轨。",
      },
    );
  }

  // Clip-specific actions (only when a clip is selected). e2e-report F149:
  // "请用 assets 能力" / "请用 assembly 能力" leaked the internal skill module
  // names — rewritten to natural user intent. Agent infers which module to
  // dispatch from semantic content of the request.
  if (clip?.kind === "video")
    actions.push(
      {
        label: t("chat.quickActions.studio.regenClip"),
        title: t("chat.quickActions.studio.regenClipHint"),
        prompt: `请重新生成这段视频片段（clip ${clip.id}），换个角度或表现方式都可以。`,
      },
      {
        label: t("chat.quickActions.studio.adjustRhythm"),
        title: t("chat.quickActions.studio.adjustRhythmHint"),
        prompt: `请调整这段片段（clip ${clip.id}）前后的剪辑节奏，让整体更有张力。`,
      },
    );
  if (clip?.kind === "audio")
    actions.push({
      label: t("chat.quickActions.studio.swapBgm"),
      title: t("chat.quickActions.studio.swapBgmHint"),
      prompt: "给我 3 个不同风格的 BGM 候选，我想试试看哪个最搭。",
    });

  if (actions.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: 8,
        flexWrap: "wrap",
        borderTop: "1px solid var(--border)",
      }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => send(a.prompt)}
          title={a.title || undefined}
          className="quick-action"
          disabled={a.disabled}
          aria-disabled={a.disabled || undefined}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
