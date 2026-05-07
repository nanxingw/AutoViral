import { useChatSocket } from "@/features/chat/useChatSocket";
import { useEditor } from "../store";
import { useParams } from "react-router-dom";

/**
 * Carousel-flavour QuickActions, the editor-side counterpart of
 * studio's `<QuickActions />`. Targets the currently-selected slide
 * (or the first slide if none is selected). Each action shoves a
 * canned prompt into the chat socket, mirroring the studio pattern.
 */
export function ChatQuickActions() {
  const car = useEditor((s) => s.car);
  const sel = useEditor((s) => s.currentSlideId);
  const { workId } = useParams();
  const { send } = useChatSocket(workId ?? null);
  if (!car || car.slides.length === 0) return null;

  const slide = car.slides.find((s) => s.id === sel) ?? car.slides[0];
  const slideIdx = car.slides.findIndex((s) => s.id === slide.id);
  const slideRef = `slide ${slideIdx + 1}`;

  const actions: { label: string; prompt: string }[] = [
    {
      label: "写一段引导文案",
      prompt: `请用 planning 能力为 ${slideRef} 写一段 30 字以内的引导文案，符合小红书图文调性。`,
    },
    {
      label: "重生成此图",
      prompt: `请用 assets 能力为 ${slideRef} 重新生成背景图，保持当前风格但换一个角度。`,
    },
    {
      label: "换 palette",
      prompt: `请基于当前图文内容推荐 3 个不同的 palette 候选（mono / pastel / earth / noir / neon），说明每个的情绪取向。`,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: 8,
        flexWrap: "wrap",
        borderTop: "1px solid var(--divider)",
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
