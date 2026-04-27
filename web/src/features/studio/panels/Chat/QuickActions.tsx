import { useComposition } from "../../store";
import { useChatSocket } from "@/features/chat/useChatSocket";
import { useParams } from "react-router-dom";

export function QuickActions() {
  const sel = useComposition((s) => s.selection);
  const comp = useComposition((s) => s.comp);
  const clip = comp?.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === sel);
  const { workId } = useParams();
  const { send } = useChatSocket(workId ?? null);
  if (!clip) return null;

  const actions: { label: string; prompt: string }[] = [];
  if (clip.kind === "video")
    actions.push(
      {
        label: "重生成此片段",
        prompt: `请用 assets 能力为 clip ${clip.id} 产出新的视频内容`,
      },
      {
        label: "调整节奏",
        prompt: `请用 assembly 能力调整 clip ${clip.id} 周围的节奏`,
      },
    );
  if (clip.kind === "audio")
    actions.push({
      label: "换 BGM 风格",
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
