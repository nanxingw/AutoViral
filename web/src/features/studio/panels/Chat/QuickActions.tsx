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
  const actions: { label: string; prompt: string }[] = [];

  // R45 — always-available creation shortcuts. Pre-fix users had no idea
  // TTS / ASR-caption capabilities existed because the entry was buried
  // inside the GenerationDialog audio sub-tab. These two prompts let
  // users invoke them directly via chat — agent then dispatches to
  // /api/audio/tts and /api/audio/captions.
  if (workId) {
    actions.push(
      {
        label: t("chat.quickActions.studio.generateNarration"),
        prompt:
          "我想给这个视频加一段中文 narration 旁白。先按你对当前情感意图的理解，写一段 30-60 秒的脚本（口语、有节奏、有钩子），然后用 zh-CN-XiaoxiaoNeural（warm conversational）调 /api/audio/tts 生成 mp3 落到 assets/audio/，把它加进 timeline 的 audio 轨。",
      },
      {
        label: t("chat.quickActions.studio.generateCaptions"),
        prompt:
          "给当前 timeline 上的视频/音频自动转写出字幕。调 /api/audio/captions 拿 word-level 时间戳，然后调 subtitle_burn.py 生成 douyin-highlight 风格的 ASS 字幕，加进 text 轨。如果遇到 PYTHON_DEP_MISSING，告诉用户跑 pip install stable-ts。",
      },
    );
  }

  // Clip-specific actions (only when a clip is selected).
  if (clip?.kind === "video")
    actions.push(
      {
        label: t("chat.quickActions.studio.regenClip"),
        prompt: `请用 assets 能力为 clip ${clip.id} 产出新的视频内容`,
      },
      {
        label: t("chat.quickActions.studio.adjustRhythm"),
        prompt: `请用 assembly 能力调整 clip ${clip.id} 周围的节奏`,
      },
    );
  if (clip?.kind === "audio")
    actions.push({
      label: t("chat.quickActions.studio.swapBgm"),
      prompt: "请用 assets 能力提供 3 个不同风格的 BGM 候选",
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
          className="quick-action"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
