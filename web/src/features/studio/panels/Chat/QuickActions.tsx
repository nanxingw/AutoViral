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
  if (!clip) return null;

  // Prompts stay Chinese — the agent's autoviral skill expects Mandarin
  // for short-video flavor. Only labels are i18n'd.
  const actions: { label: string; prompt: string }[] = [];
  if (clip.kind === "video")
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
  if (clip.kind === "audio")
    actions.push({
      label: t("chat.quickActions.studio.swapBgm"),
      prompt: "请用 assets 能力提供 3 个不同风格的 BGM 候选",
    });

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
